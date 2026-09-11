# Optional GitHub webhooks

Status: future option. Keep 60-second polling as the default for now.

The existing [webhooks decision](../docs/webhooks.md) is the source of truth for the rationale and proposed design. Read it before implementing; do not create a second event-processing pipeline.

A verified webhook should trigger the existing GitHub snapshot read and comparison. Preserve the MCP interface and notification text. Retain polling for repositories without webhook access and occasional reconciliation for missed deliveries.

The unresolved choice is how GitHub reaches the local installation: a user-provided receiver, a relay, or a hosted GitHub App. Each adds setup or operating requirements. GitHub cannot send directly to localhost, and contributors may lack permission to configure repository hooks.

Done when the receiver choice is explicit, signatures and delivery IDs are validated, duplicate/missed deliveries are tested, and unavailable webhooks fall back to polling. This is not required before npm publication.
