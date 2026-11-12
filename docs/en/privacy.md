# Privacy and data flow

MUSE FRAME runs on loopback. It stores shoots, prompts and downloaded images on your computer. The packaged WebUI keeps provider authorization in its own per-user profile on Mac or Windows. Connecting an account is a user action. Workspace migration and in-app backup exclude provider credentials.

When you authorize a platform, its authorization service handles the login flow. When you submit a generation or edit task, the selected reference images and prompt are sent to that platform, where its own policies apply. Online libraries request catalogs, thumbnails and selected originals from their source hosts. Repository links visit GitHub.

The workbench uses the provider for account authorization and generation. Providers, GitHub and gallery hosts can receive information about the network requests they handle.

Exports and diagnostics can contain personal images, prompts or identifiers. Review them before sharing. Keep authorization files and entire manual profile backups private. The [quick start](quick-start.md) lists the profile locations and the workspace backup controls.
