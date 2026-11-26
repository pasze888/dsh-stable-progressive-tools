# Stable Progressive Tools

Session-stable progressive tool disclosure for DeepSeek Harness, separating what a model can see from what it may execute.

## Language

**Surface**:
The complete tool presentation visible to a model within a session, independent of execution permission.
_Avoid_: Tool registry, tool runtime

**Stable Surface**:
A Surface whose visible definition remains unchanged for the lifetime of a session.
_Avoid_: Frozen registry, static permissions

**Disclosure**:
On-demand presentation of tool details in the conversation, without granting execution permission.
_Avoid_: Unlocking, authorization

**Tool Catalog**:
The current set of tools in a session's scope that can be discovered, independent of the frozen initial Surface.
_Avoid_: Cached registry, revealed-tool set

**Discovery**:
Finding tools in the current Tool Catalog and obtaining their details through appended results.
_Avoid_: Permission elevation, Surface mutation

**Eager Tool**:
A tool whose details are included in the initial Surface.
_Avoid_: Preauthorized tool, always-enabled tool

**Cache Epoch**:
A period of cache continuity within a session; compaction starts a new one.
_Avoid_: Permanent cache, session cache
