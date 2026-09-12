# Update code while retaining watches

Status: implemented. See [update behavior](../docs/updates.md).

New MCP sessions or CLI calls load their selected npm channel. A successfully loaded newer worker advertises its runtime, waits for the current worker to drain, and acquires the existing lease. Persisted watch state is retained. The remembered runtime prevents older clients from restarting an older worker after idle. No permanent supervisor or background registry poll was added.

Process tests exercise accepted and ambiguous in-flight deliveries, baseline and pending-state retention, failed candidate startup, older clients after idle, and MCP startup recovery.
