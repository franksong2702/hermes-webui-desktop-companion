# WinUI Host

This folder is reserved for the native Windows host.

The first scaffold keeps the runnable protocol in Node so it can be tested on
macOS while the WebUI extension contract is still being shaped. The WinUI host
should later replace or embed the same loopback protocol instead of reaching
into Hermes WebUI internals.

Expected future responsibilities:

- desktop window and tray lifecycle
- pet renderer
- local preferences
- native notifications
- loopback API compatibility with `docs/protocol.md`

