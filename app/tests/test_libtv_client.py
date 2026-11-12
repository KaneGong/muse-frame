import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import libtv_direct


class LibTVClientTests(unittest.TestCase):
    def test_reconnect_discards_expired_session_and_model_schema_cache(self):
        bridge = libtv_direct.LibTVBridge()
        bridge.session='expired-session';bridge.protocol='2025-06-18';bridge.tools={'create_node':{}};bridge._schemas={'old':{'schema':{}}}
        bridge.close()
        self.assertIsNone(bridge.session)
        self.assertIsNone(bridge.protocol)
        self.assertEqual(bridge._schemas,{})

    def test_catalog_network_error_does_not_turn_into_a_fake_live_catalog(self):
        bridge=libtv_direct.LibTVBridge()
        def offline(*a,**k):raise OSError('network unavailable')
        bridge.tool=offline
        with self.assertRaises(OSError):bridge._list_models({})

    def test_client_copied_from_another_tool_is_reregistered_for_our_callback(self):
        with tempfile.TemporaryDirectory() as tokens, patch.dict(os.environ, {'PORTRAIT_TOKEN_DIR': tokens}):
            stale = {'client_id': 'dsh-client', 'client_name': 'DeepSeek Harness (LibTV)',
                     'redirect_uris': ['http://127.0.0.1:63911/callback']}
            Path(tokens, 'libtv-client.json').write_text(json.dumps(stale))
            fresh = {'client_id': 'studio-client', 'client_name': 'AI Portrait Studio',
                     'redirect_uris': [libtv_direct.REDIRECT_URI]}
            with patch.object(libtv_direct, '_post_json', return_value=fresh) as register:
                client = libtv_direct.register_client()
            self.assertTrue(register.called)
            self.assertEqual(client['client_id'], 'studio-client')
            saved = json.loads(Path(tokens, 'libtv-client.json').read_text())
            self.assertEqual(saved['client_id'], 'studio-client')

    def test_matching_callback_reuses_the_stored_client(self):
        with tempfile.TemporaryDirectory() as tokens, patch.dict(os.environ, {'PORTRAIT_TOKEN_DIR': tokens}):
            stored = {'client_id': 'studio-client', 'redirect_uris': [libtv_direct.REDIRECT_URI]}
            Path(tokens, 'libtv-client.json').write_text(json.dumps(stored))
            with patch.object(libtv_direct, '_post_json') as register:
                client = libtv_direct.register_client()
            self.assertFalse(register.called)
            self.assertEqual(client['client_id'], 'studio-client')

    def _fake_bridge(self, node_args):
        bridge = libtv_direct.LibTVBridge()

        def fake_tool(name, arguments=None):
            arguments = arguments or {}
            if name == 'get_model':
                return {'schema': {'properties': {}}}
            if name == 'create_node':
                node_args.update(arguments)
                return {'nodeId': 'node-out', 'taskId': 'task-123'}
            return {}

        bridge.tool = fake_tool
        return bridge

    def test_edit_mode_attaches_images_as_image2image_reference(self):
        # 修改模式后端传的是 images=refs；之前 _generate 只读 ref_images，
        # 原图被丢掉、退化成纯文生图。此测试锁定 images 也被认作参考图。
        node_args = {}
        bridge = self._fake_bridge(node_args)
        result = bridge._generate({
            'model': 'lib-image-2.5-f',
            'prompt': '把背景换成海边',
            'images': ['libtv:node-ref'],
        })
        self.assertEqual(node_args['left'], ['node-ref'])
        self.assertEqual(node_args['model'], 'lib-image-2.5-f')
        self.assertIn('图1={{Node node-ref}}', node_args['prompt'])
        self.assertEqual(result['structuredContent']['task_ids'], ['task-123'])

    def test_generate_mode_still_uses_ref_images(self):
        # 生成模式走 ref_images，回归保护，避免修 edit 时误伤生成路径。
        node_args = {}
        bridge = self._fake_bridge(node_args)
        bridge._generate({
            'model': 'lib-image-2.5-f',
            'prompt': '生成一张人像',
            'ref_images': ['libtv:node-a', 'libtv:node-b'],
        })
        self.assertEqual(node_args['left'], ['node-a', 'node-b'])
        self.assertEqual(node_args['model'], 'lib-image-2.5-f')
        self.assertIn('图2={{Node node-b}}', node_args['prompt'])

    def test_duplicate_reference_nodes_are_deduped_but_prompt_slots_are_preserved(self):
        node_args = {}
        bridge = self._fake_bridge(node_args)
        bridge._generate({
            'model': 'lib-image-2.5-f',
            'prompt': '图1的人物沿用图2的身形，图3为服装',
            'ref_images': ['libtv:node-a', 'libtv:node-a', 'libtv:node-b'],
        })
        self.assertEqual(node_args['left'], ['node-a', 'node-b'])
        self.assertIn('图1={{Node node-a}}', node_args['prompt'])
        self.assertIn('图2={{Node node-a}}', node_args['prompt'])
        self.assertIn('图3={{Node node-b}}', node_args['prompt'])

    def test_describe_and_generate_map_ratio_resolution_quality_and_size(self):
        bridge = libtv_direct.LibTVBridge()
        schema = {'schema': {'properties': {
            'ratio': {'enum': ['3:4', '16:9']},
            'resolution': {'enum': ['2K', '4K']},
            'quality': {'enum': ['standard', 'high']},
            'size': {'enum': ['1024*1365', '1536*2048']},
        }}}
        bridge.tool = lambda name, arguments=None: schema
        described = bridge._describe_model({'model': 'lib-image-2.5-f'})['structuredContent']['schema']['properties']
        self.assertEqual(described['aspect_ratio']['enum'], ['3:4', '16:9'])
        self.assertEqual(described['resolution']['enum'], ['2K', '4K'])
        self.assertEqual(described['size']['enum'], ['1024*1365', '1536*2048'])
        node_args = {}
        bridge = self._fake_bridge(node_args)
        bridge.tool = lambda name, arguments=None: schema if name == 'get_model' else (
            node_args.update(arguments or {}) or {'nodeId': 'node-out', 'taskId': 'task-123'} if name == 'create_node' else {})
        bridge._generate({'model': 'lib-image-2.5-f', 'prompt': '生成',
                          'aspect_ratio': '16:9', 'resolution': 'high', 'size': '1536*2048'})
        self.assertEqual(node_args['params'], {'count': 1, 'ratio': '16:9', 'quality': 'high', 'size': '1536*2048'})

    def test_upload_finds_existing_node_after_an_operation_receipt(self):
        bridge = libtv_direct.LibTVBridge()
        bridge.project = 'project-a'
        calls = []
        def tool(name, args):
            calls.append((name, args))
            if name == 'upload_ticket':
                return {'parts':[{'url':'https://upload.invalid/'}], 'uploadId':'upload-a', 'path':'file-a'}
            if name == 'upload_complete':
                return {'file_ref':'file-a'}
            if name == 'upload_media':
                return {'operationId':'wop_upload-a', 'status':'pending'}
            if name == 'get_web_operation_status':
                return {'result':{'nodeId':'i-existing'}}
            if name == 'read_node':
                return {'nodeId':'i-existing', 'node':{'data':{'url':['https://libtv-res.liblib.art/example.png']}}}
            self.fail(name)
        bridge.tool = tool
        with patch.object(libtv_direct, '_put'), patch.object(libtv_direct, '_remember_node'):
            result = bridge._upload({'data_base64':'AQID', 'filename':'test.png'})['structuredContent']
        self.assertEqual(result['platform_node_id'], 'i-existing')
        self.assertEqual([name for name, _ in calls].count('upload_media'), 1)
        self.assertEqual(calls[-1][1]['node'], 'i-existing')

    def test_pending_upload_resumes_same_write_after_a_bounded_wait(self):
        bridge = libtv_direct.LibTVBridge()
        bridge.project = 'canvas-a'
        bridge.token = {'account_id': 'fixture'}
        calls = []
        ready = False
        def tool(name, args):
            calls.append((name, args))
            if name == 'upload_ticket':
                return {'parts':[{'url':'https://upload.invalid/'}], 'uploadId':'upload-a', 'path':'file-a'}
            if name == 'upload_complete':
                return {'fileRef':'file-a'}
            if name == 'upload_media':
                return {'operationId':'wop_fixture', 'status':'pending'}
            if name == 'get_web_operation_status':
                return {'result':{'nodeId':'node-ref'}} if ready else {'status':'pending'}
            if name == 'read_node':
                return {'nodeId':'node-ref', 'node':{'data':{'url':['https://libtv-res.liblib.art/a.png']}}} if ready else {}
            self.fail(name)
        bridge.tool = tool
        with tempfile.TemporaryDirectory() as tokens, patch.dict(os.environ, {'PORTRAIT_TOKEN_DIR': tokens}), \
                patch.object(libtv_direct, '_put'), patch.object(libtv_direct.time, 'sleep'):
            payload = {'data_base64':'AQID','filename':'test.png','upload_key':'same-content'}
            with self.assertRaisesRegex(libtv_direct.PreparationError, '审核'):
                bridge._upload(payload)
            ready = True
            result = bridge._upload(payload)['structuredContent']
        self.assertEqual(result['platform_node_id'], 'node-ref')
        self.assertEqual([name for name, _ in calls].count('upload_ticket'), 1)
        self.assertEqual([name for name, _ in calls].count('upload_media'), 1)

    def test_known_task_without_node_retains_exact_node_receipt(self):
        bridge = libtv_direct.LibTVBridge()
        bridge.project = 'canvas-a'
        bridge._live_schema = lambda _: {}
        bridge.connect = lambda: None
        def tool(name, args):
            if name == 'create_node':
                return {'taskId':'task-123'}
            if name == 'read_node':
                return {'nodeId':'node-output','node':{'id':'node-output','data':{'taskInfo':{'taskId':'task-123'}}}}
            self.fail(name)
        bridge.tool = tool
        result = bridge._generate({'model':'lib-image-2.5-f','prompt':'test',
            'receipt':{'project_id':'canvas-a','node_name':'unique','submission_key':'unique'}})['structuredContent']
        self.assertEqual(result['task_ids'], ['task-123'])
        self.assertEqual(result['node_id'], 'node-output')

    def test_missing_create_receipt_recovers_exact_node_without_second_write(self):
        bridge = libtv_direct.LibTVBridge()
        bridge.connect = lambda: None
        bridge.project = 'canvas-a'
        bridge._schemas['fixture'] = {}
        calls = []
        def tool(name, args):
            calls.append((name, args))
            if name == 'create_node':
                return {'nodeId': 'i-exact', 'operationId': 'cop_canvas_only'}
            if name == 'read_node':
                return {'nodeId': 'i-exact', 'node': {'id': 'i-exact',
                    'data': json.dumps({'taskInfo': {'taskId': 'task-123'}})}}
            self.fail(name)
        bridge.tool = tool
        receipt = bridge.prepare_submission('0123456789abcdefabcd', '修改背景')
        result = bridge._generate({'model': 'fixture', 'prompt': '修改背景', 'receipt': receipt})['structuredContent']
        self.assertEqual(result['task_ids'], ['task-123'])
        self.assertEqual(result['node_id'], 'i-exact')
        self.assertEqual([name for name, _ in calls], ['create_node', 'read_node'])
        self.assertEqual(calls[0][1]['idempotencyKey'], receipt['submission_key'])
        self.assertIsNone(libtv_direct._task_id({'taskId': 'cop_canvas_only'}))

    def test_expired_status_uses_materialized_image_only_for_exact_task(self):
        bridge = libtv_direct.LibTVBridge()
        url = 'https://libtv-res.liblib.art/result/example.png'
        def tool(name, args):
            if name == 'task_status':
                raise RuntimeError('TASK_CONTEXT_UNAVAILABLE: Task context is absent or expired')
            if name == 'read_node':
                return {'nodeId': 'i-exact', 'node': {'data': {'taskInfo': {
                    'taskId': 'task-123', 'status': 2, 'loading': False}, 'url': [url]}}}
            self.fail(name)
        bridge.tool = tool
        args = {'task_ids': ['task-123'], 'project_id': 'canvas-a', 'node_id': 'i-exact'}
        with patch.object(libtv_direct, '_remember_node'):
            status, _, artifacts = bridge._read_generation(args)
        self.assertEqual(status, 'completed')
        self.assertEqual(artifacts[0]['url'], url)
        self.assertEqual(bridge._read_generation({**args, 'task_ids': ['task-456']})[0], 'not_found')

    def test_cancel_and_failure_follow_the_remote_task_receipt(self):
        bridge = libtv_direct.LibTVBridge()
        bridge.project = 'current-project'
        calls = []
        outcome = 'PENDING'
        def tool(name, args):
            calls.append((name, args))
            if name == 'task_cancel':
                return {'ok': True}
            return {'outcome': outcome, 'error': {'message': 'fixture failure'} if outcome == 'FAILED' else None}
        bridge.tool = tool
        request = {'task_id': 'task-a', 'project_id': 'original-project'}
        self.assertFalse(bridge._cancel(request)['structuredContent']['cancelled'])
        outcome = 'CANCELLED'
        self.assertTrue(bridge._cancel(request)['structuredContent']['cancelled'])
        outcome = 'FAILED'
        result = bridge._task_status({'task_ids': ['task-a'], 'project_id': 'original-project'})
        self.assertEqual(result['structuredContent']['error']['message'], 'fixture failure')
        self.assertTrue(all(args['project_id'] == 'original-project' for _, args in calls))

    def test_project_id_is_rebuilt_after_account_scoped_refusal(self):
        bridge = libtv_direct.LibTVBridge()
        bridge.token = {'sub': 'account-a'}
        bridge.project = 'stale'
        calls = []

        def tool(name, arguments=None):
            calls.append(name)
            if name == 'create_node' and calls.count('create_node') == 1:
                raise RuntimeError('project not found on this account')
            if name == 'create_project':
                return {'projectId': 'fresh'}
            return {'nodeId': 'node-out', 'taskId': 'task-123'}

        bridge.tool = tool
        with tempfile.TemporaryDirectory() as tokens, patch.dict(os.environ, {'PORTRAIT_TOKEN_DIR': tokens}):
            result = bridge._project_tool('create_node', {'projectId': 'stale'})
            self.assertEqual(result['nodeId'], 'node-out')
            self.assertEqual(bridge.project, 'fresh')
            self.assertEqual(json.loads(Path(tokens, 'libtv-workbench-project.json').read_text())['account'], 'account-a')

    def test_node_index_is_scoped_and_does_not_evict_old_entries(self):
        with tempfile.TemporaryDirectory() as tokens, patch.dict(os.environ, {'PORTRAIT_TOKEN_DIR': tokens}):
            for i in range(501):
                libtv_direct._remember_node('https://cdn/%d.jpg' % i, 'node-%d' % i,
                                            project_id='project-a', account='account-a')
            libtv_direct._remember_node('https://cdn/shared.jpg', 'node-b',
                                        project_id='project-b', account='account-b')
            self.assertEqual(libtv_direct._node_id('https://cdn/0.jpg', 'project-a', 'account-a'), 'node-0')
            self.assertIsNone(libtv_direct._node_id('https://cdn/0.jpg', 'project-a', 'account-b'))
            self.assertEqual(libtv_direct._node_id('https://cdn/shared.jpg', 'project-b', 'account-b'), 'node-b')

    def test_node_index_falls_back_across_projects_within_the_same_account(self):
        with tempfile.TemporaryDirectory() as tokens, patch.dict(os.environ, {'PORTRAIT_TOKEN_DIR': tokens}):
            libtv_direct._remember_node('https://cdn/reused.jpg', 'node-reused',
                                        project_id='source-project', account='account-a')
            # 参考图从其他项目复用时，同账号内必须能找回节点，否则会被误判为未上传
            self.assertEqual(libtv_direct._node_id('https://cdn/reused.jpg', 'target-project', 'account-a'), 'node-reused')
            self.assertIsNone(libtv_direct._node_id('https://cdn/reused.jpg', 'target-project', 'account-a',
                                                    strict_project=True))
            # 跨账号仍然隔离
            self.assertIsNone(libtv_direct._node_id('https://cdn/reused.jpg', 'target-project', 'account-b'))

    def test_completed_task_collects_artifacts_and_records_node(self):
        # 回归保护：完成任务回收路径必须真的产出 artifacts。
        # 之前 artifacts.extend 被误缩进进 except+continue 之后，正常任务永远取不到图。
        with tempfile.TemporaryDirectory() as tokens, patch.dict(os.environ, {'PORTRAIT_TOKEN_DIR': tokens}):
            bridge = libtv_direct.LibTVBridge()
            bridge.project = 'proj-1'

            def fake_tool(name, arguments=None):
                if name == 'task_status':
                    return {'outcome': 'SUCCEEDED', 'artifacts': [{'node_key': 'node-abc'}]}
                if name == 'read_node':
                    return {'node': {'data': {'taskInfo': {'taskResult': {
                        'images': [{'previewPath': 'https://cdn/x.jpg'}]}}}}}
                return {}

            class NoNetwork:
                def open(self, *a, **k):
                    raise OSError('no network in test')

            bridge.tool = fake_tool
            bridge._opener = NoNetwork()
            result = bridge._task({'task_ids': ['task-1']})
            artifacts = result['structuredContent']['artifacts']
            self.assertEqual(len(artifacts), 1)
            self.assertEqual(artifacts[0]['url'], 'https://cdn/x.jpg')
            self.assertEqual(artifacts[0]['platform_node_id'], 'node-abc')
            # 同时应建立 URL→node 映射，供后续当参考图使用
            self.assertEqual(libtv_direct._node_id('https://cdn/x.jpg', 'proj-1'), 'node-abc')


if __name__ == '__main__':
    unittest.main()
