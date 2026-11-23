"""Transactional conflict checks and the lightweight job feed use isolated data."""
import concurrent.futures
import tempfile
import unittest
from pathlib import Path
from threading import Barrier
from unittest.mock import patch

from test_beta_integration import fixture_app
from beta_store import read_workspace, save_workspace, WorkspaceConflict
from beta_jobs import conditional_job_feed


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.app = fixture_app(Path(self.directory.name))
        self.app.stop.set()
        self.addCleanup(self.app.store.db.close)
        self.state = {key: [] for key in ("assets", "outputs", "tasks", "recipes", "experiments", "products", "batches")}
        self.state["shoots"] = [{"id": key, "title": key, "revision": 1} for key in ("one", "two")]
        self.base = save_workspace(self.app, {"state": self.state, "ui": {}, "revision": None})["revision"]

    def apply(self, changes):
        return save_workspace(self.app, {"revision": self.base, "patch": changes})

    def change(self, shot, field, before, after):
        return {"path": ["state", "shoots", {"id": shot}, field], "before": before, "after": after}

    def test_simultaneous_windows_keep_both_shoots_and_rollback_an_entire_conflict(self):
        start = Barrier(2)
        def edit(key):
            start.wait()
            self.apply([self.change(key, "title", key, "saved " + key)])
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as workers:
            list(workers.map(edit, ("one", "two")))
        with self.assertRaises(WorkspaceConflict) as error:
            self.apply([self.change("one", "revision", 1, 22), self.change("two", "title", "two", "later draft")])
        self.assertEqual(error.exception.path, ["state", "shoots", {"id": "two"}, "title"])
        rows = read_workspace(self.app.store)["state"]["shoots"]
        self.assertEqual([(row["title"], row["revision"]) for row in rows], [("saved one", 1), ("saved two", 1)])

    def test_nested_different_fields_and_preserved_concurrent_appends(self):
        self.apply([self.change("one", "revision", 1, 5), self.change("one", "title", "one", "new")])
        self.apply([self.change("one", "revision", 1, 2), {"path": ["state", "shoots", {"id":"one"}, "note"], "after": "B"}])
        self.apply([{"path":["state", "shoots", {"id":"three"}], "after":{"id":"three"}}])
        self.apply([{"path":["state","shoots"], "order":True, "before":["one","two"], "after":["two","one"]}])
        rows = read_workspace(self.app.store)["state"]["shoots"]
        self.assertEqual([r["id"] for r in rows], ["two","one","three"])
        self.assertEqual(rows[1], {"id":"one","title":"new","revision":5,"note":"B"})

    def test_idle_query_never_materializes_jobs_and_other_connection_wakes_it(self):
        from store import Store
        db = self.app.store
        first = conditional_job_feed(db)
        with patch("beta_jobs.job_feed", side_effect=AssertionError("idle reload")):
            self.assertEqual(conditional_job_feed(db, first["token"]), {"token":first["token"], "unchanged":True})
        other = Store(db.root)
        try:
            other.put_project("external",{})
        finally:
            other.db.close()
        result = conditional_job_feed(db, first["token"])
        self.assertNotEqual(result["token"], first["token"])
        self.assertEqual(result["jobs"], [])
