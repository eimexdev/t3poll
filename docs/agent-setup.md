# Agent setup

Use this guide when asked to install or configure t3poll. For updates, follow [README updates](../README.md#updates).

Keep the running T3 server and ongoing conversations intact. Setup creates a credential but does not require a watch, a test message, or a T3 restart.

1. Reuse an existing checkout of `https://github.com/eimexdev/t3poll`, or choose a suitable installation directory. Follow [installation](setup.md#install). Verify Node and authenticated GitHub CLI are available to the MCP process. Build successfully before configuring it.
2. Add the minimal entry from [MCP registration](setup.md#register-mcp) to the Codex configuration home used by T3's provider. Preserve unrelated entries. Use absolute executable/script paths where needed. Existing explicit credentials can remain configured; they stay user-managed. A new standard installation needs no connection variables.
3. Run [verification](setup.md#verify). `list` with `threads=true` automatically discovers T3 and creates a credential. If discovery reports multiple instances, ask the user to select the reported home and set `T3POLL_BASE_DIR`. For unsupported layouts, follow [manual overrides](setup.md#select-an-instance-or-use-manual-credentials). Do not guess the destination conversation.
4. Verify the client exposes `watch`, `list`, and `stop` after a reconnect or new provider session. Preserve ongoing work while it loads. Report the installation directory, changed config file, and verification result. If only the CLI was tested, say that MCP verification is still pending.

If saved watches exist, `list` may restart monitoring. Use an isolated `T3POLL_HOME` for testing when restarting those watches is outside the user's requested scope. Such a test creates credentials in the isolated directory and does not configure the production state directory.

Setup is complete when the client exposes the tools and a connection check lists T3 threads without sending a message. Managed credentials remain in t3poll's private state directory and renew on use; never include their contents in the report.
