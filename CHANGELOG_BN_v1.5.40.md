# Changelog v1.5.41

- Changed guest invites to the canonical Blogger root URL: `https://liveuseradmin9x.blogspot.com/?invite=...`.
- Changed host join URL to Blogger root plus URL fragment; no live page path is used.
- Separated Admin Panel origin validation from public Live Room origin so the Admin Panel remains on wuaze.com.
- Updated the Blogger Live Status widget to trust only the Blogger root invite URLs.
- Added a Blogger-importable Live Room theme XML generated from the existing `live-room.html` source.
- Updated env example, deployment guide and tests.
