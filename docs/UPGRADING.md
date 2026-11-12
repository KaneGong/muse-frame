# Upgrading and preserving your data

For 0.5.0-beta.5 and later WebUI upgrades, see [Update, migrate and roll back](en/quick-start.md#update-migrate-and-roll-back).

## Earlier Mac App

Prepared for the prompt-system update. This document does not mean that the development build has been publicly released.

1. Finish generation jobs, save your work and quit the app.
2. Back up the entire data directory and retain the previous app. The default macOS location is ~/Library/Application Support/AI Portrait Studio Standalone. Include the database, images and task records. Authentication files are private: never attach them to GitHub issues or share them.
3. Normal upgrades keep the existing directory. Existing projects retain their original prompt format and remain editable. Changing a control explicitly updates its corresponding content; opening a project does not automatically rewrite it.
4. New projects use neutral shooting requirements, whole-shoot styling with optional shot overrides, independent pose references, additional notes and a separate custom full-prompt draft.
5. To recreate an old project with the new structure, create a new project and reuse images from the old one. Select the references you actually want to use. You can paste an old prompt into Custom full prompt. Duplicating a project preserves its format; it is not an automatic converter.

Older projects cannot recover per-shot references that were never stored. Review pose references in old multi-shot projects.

## Optional local fresh profile

Only an explicitly requested local build with fresh-profile enabled uses:

~/Library/Application Support/AI Portrait Studio Standalone Prompt V2

The original directory remains intact. An empty project list in this profile does not mean your old data was deleted. Platform authorization is not migrated automatically. General release builds must not silently switch users to an empty directory.

## Rollback

Keep both the previous app and its original data directory. Do not let an older app write a directory containing newer project structures. Preserve the newer directory before any restore, and use a separate copy if recovery is needed. Never overwrite newer images or task records with an older backup, run two apps against one data directory, or automatically merge personal and testing profiles.

For feedback, share the version, platform/model, reproduction steps and selected screenshots. Do not upload authentication files or entire data directories. Review prompt and image privacy before publishing.
