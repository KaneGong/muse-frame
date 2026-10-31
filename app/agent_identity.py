"""Conservative client labels, based only on MCP handshake or executor report."""
import re
NAMES={'hermes':'Hermes','hermesagent':'Hermes','codex':'Codex','openaicodex':'Codex','claudecode':'Claude Code','claudedesktop':'Claude Desktop','claude':'Claude','workbuddy':'WorkBuddy','deepseekharness':'DeepSeek Harness','openclaw':'OpenClaw','cursor':'Cursor'}
def identify_agent(reported='',client=''):
    for value,source in [(reported,'agent_reported'),(client,'mcp_client')]:
        if not isinstance(value,str):continue
        key=re.sub(r'[^a-z0-9]','',value.lower())
        if key in NAMES:return NAMES[key],source
    return 'AGENT','unknown'
