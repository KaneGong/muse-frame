# Privacy and data flow

MUSE FRAME runs a local server on the loopback interface. Projects, prompts and downloaded assets are saved locally. The Mac App keeps its own platform authorization in its application-data directory. A fresh install does not import another application's accounts.

When you authorize a platform, its authorization service receives the login/authorization flow. When you submit a generation or edit task, the selected reference images and prompt are sent to that platform; its own policies apply. Online libraries request catalogs, thumbnails and selected originals from their source hosts. Clicking repository/source links visits GitHub.

This preview adds no project-maintainer analytics, account-registration server or billing backend. External platforms, GitHub and library hosts can still receive network information for requests made to them. Do not describe generation as offline or as keeping all references on your computer.

Exports and diagnostics can contain personal images, prompts or identifiers. Review them before sharing. Never submit token files, the complete application data directory or private pictures to public Issues. Backups of application data include authorization and should be protected accordingly.
