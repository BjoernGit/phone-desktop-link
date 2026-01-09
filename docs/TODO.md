# TODO

- ~~Check transfer handling: If the sending computer removes a file from the list during an active transfer, the transfer keeps running in the background.~~ **DONE** - Implemented sender-authoritative file revocation. When a file is removed, active transfers are cancelled and receivers discard partial data.
- Reduce QR scan cognitive overload: scanning on mobile currently offers "send session" vs "read session", but users just want sessions merged; implement a routine that ensures all computers in session A are fully merged with all computers in session B.
- After session merge, sync files from all computers: loadable files should be pulled into the "loadable files" list for on-demand download, and images should be sent to peers that do not have them yet.
