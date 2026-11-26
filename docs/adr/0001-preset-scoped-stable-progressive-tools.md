# Preset-scoped stable progressive tools

**Status**: accepted

DSH 的 PTC Executor 会为每个模型步骤重新生成完整 SDK，直接追加声明无法隐藏工具，动态文本还会破坏前缀缓存。我们决定在独立的 `stable-ptc-eval` preset 中，通过 `system-prompt/assemble` waterfall 整体替换 `tools:sdk`，同时保持普通 `ptc` 和子 Agent 不变。

## 最终决策

以下决策优先于后方原始草案中的冲突内容。

1. **P0 是纯 Code 模式**：只包含固定 SDK、Search、Describe、实时 Binding、Shell 选择和宿主契约测试，不包含 Native、Both、Plan Mode 或 HistoryGuard。
2. **按 preset scope 隔离**：插件只安装在 `stable-ptc-eval` 的插件树中，不做全局挂载；普通 `ptc` 不安装插件。
3. **采用 section 改写方案**：整体替换 `tools:sdk`，保留 `run_code` 原描述，不替换或包装 PTC Executor。
4. **配置简化**：删除 `activation.enabledPresets`；保留 `includeSubagents: false`，通过会话来源排除子 Agent，而不是依赖 scope。
5. **统一 PTC 调用方式**：Search、Describe 和普通工具均通过 `tools.*()` 或 `tools["原始名称"]()` 调用；使用 `return` 将结果交给模型。
6. **Search 保持轻量**：默认最多 10 项，保留摘要、查询和结果预算；支持 `cursor` / `nextCursor` 分页。游标绑定查询、命名空间和目录指纹，目录变化时返回 `TOOL_CATALOG_CHANGED`。
7. **Describe 不设插件输出预算**：`names` 不限制数量，结果不限制总字节，不自动分页、不截断；删除 `maxDescribeTools` 和 Describe 的 `maxResultBytes` 配置。宿主或 Provider 的硬限制仍如实返回。
8. **披露不是授权**：执行始终重新经过实时 ToolRuntime、Policy、Approval、Guards 和参数校验；未 Describe 的工具也可按准确名称尝试调用。
9. **SchemaHash 从持久化历史关联**：普通工具参数不增加 Hash。存在披露记录时校验最近 Hash；不存在时直接按当前 Schema 校验。Hash 变化返回 `TOOL_SCHEMA_CHANGED`。
10. **完整持久化 Stable Surface**：保存恢复所需的规范化工具声明、SDK、固定提示、协议版本、eager 工具和 Shell；Hash 用于完整性校验而非恢复数据。重载、重启和恢复不得套用新配置，fork 继承父 Surface。
11. **Surface 创建原子化**：普通 eager 工具不可用时，在修改宿主前报错；Shell 与 eager 名称去重；SurfaceHash 覆盖全部模型可见初始内容，Surface 深度不可变。
12. **简单冲突治理**：目标 preset 只让本插件改写 `tools:sdk`，通过真实宿主测试检查；能发现异常时告警，不承诺检测所有外层 waterfall 修改。
13. **Native 不在会话中换协议**：未来若实现 Native，运行中失败只报错并告警；只有新会话可以选择 `invoke_tool`。Describe 的完整 Schema 在首次结果中持久化，禁止事后补写旧结果。
14. **观测不记录正文**：生产 Telemetry 不记录查询、参数或结果正文；Recall@5 使用带标注的离线查询集。
15. **阶段验收分离**：P0 证明工程链路正确；真实模型 A/B 和放量门槛仍在 P3 判定。

## Considered Options

- **全局插件监听**：拒绝。它会收到所有 preset 的装配，需要脆弱地反查 preset，并扩大意外影响范围。
- **替换 PTC Executor**：P0 拒绝。它能修改 `run_code` 描述，但当前没有这项需求，包装 Executor 会增加维护面。
- **在 SDK 后追加裁剪声明**：拒绝。原始完整声明仍然存在，必须整体替换 section。
- **为 Describe 设置数量、字节预算或分页**：拒绝。当前优先保持调用简单和结果完整；Search 仍保留预算和分页。

## Consequences

- waterfall 每个模型步骤都会运行，必须基于会话冻结内容确定性地重算文本，不执行 IO；`next()` 必须恰好调用一次，并保留 `interpolate: false`。
- `tools:sdk` waterfall 只能修改文本，不能修改 Native 顶层工具数组。
- 隐藏呈现不能使用会同步裁掉 Binding 的 `when` 或 `restrict`。
- 需要真实 DSH 宿主测试证明目标 preset 被裁剪、普通 `ptc` 逐字节不变、子 Agent 不受影响，以及 Describe 的返回值进入外层模型可见输出。
- Describe 不主动限制输出，可能受到宿主、模型或 Provider 的上下文和结果大小限制；这些失败不得被静默截断。

## 原始设计草案

> 以下内容复制自项目最初引用的外部设计草案，作为背景保留。若与以上最终决策冲突，以最终决策为准。
>
> 日期：2026-11-25
>
> 状态：原始草案附录
>
> 参考：`Yan-Zero/dsh-progressive-tools` 的渐进式工具呈现，以及 `Aa728848/dsh-chatgpt-subscription` 的前缀缓存保护措施。

## 1. 目标与原则

设计一个独立 DSH 插件，在不修改 Harness checkout 的前提下，为 Native、Code/PTC 与 Both 模式提供渐进式工具披露，同时避免动态工具目录、Plan Mode 和历史重写破坏前缀缓存。

核心原则：

> 模型可见的工具表面在会话内保持稳定；工具发现和 Schema 披露只作为新消息追加；工具能否执行始终由实时 ToolRuntime、Policy、Approval 和 Guards 决定。

目标：

- 降低完整工具目录和 SDK 对初始上下文的占用；
- 避免工具注册、注销和披露状态改写系统提示；
- 支持高频工具直接调用，低频工具按需发现；
- 呈现层不承担授权职责，不绕过任何执行策略；
- 能力不明确时稳定降级，不在会话中途改变工具协议。

### 启用范围

采用分阶段启用，而不是默认改写所有 Preset：

1. P0 使用独立的 `stable-ptc-eval` 评测 Preset，与现有 PTC 做 A/B；
2. 验证后将 bundle 安装到 Profile/Host Plane，但通过 `enabledPresets` 显式选择 Preset；
3. 不长期复制完整 Preset，避免后续工具和配置漂移；
4. 默认不自动应用于子 Agent、订阅项目的 `dispatch` 或其他已有 CodeMode 呈现所有者；
5. 启用决策只在会话创建时发生，已有会话不因配置变化而改变呈现。

## 2. 总体架构

```text
                     Profile / Host Plane
                             │
                  StableProgressiveTools
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
  Surface Manager       Discovery Module      Invocation Module
  会话级稳定表面         search / describe     实时权限与工具执行
        │                    │                    │
        ├─ Native Adapter    │                    ├─ Native 调用
        ├─ Code Adapter      │                    ├─ invoke_tool
        └─ Both Adapter      │                    └─ PTC bindings
                             │
                      Cache Guard
             SDK 冻结 / Plan Mode / 历史保护
                             │
                        Telemetry
                 Token、缓存、发现与失败指标
```

模块职责：

| 模块 | 职责 |
|---|---|
| `SurfaceManager` | 会话创建时确定模式、Shell、eager 工具、固定提示和 SDK；之后不得漂移 |
| `DiscoveryModule` | 搜索轻量目录，返回选中工具的完整 Schema 和 SDK 片段 |
| `InvocationModule` | 调用时重新解析实时工具注册表，并进入原工具执行管线 |
| `CacheGuard` | 防止 SDK、Plan Mode、其他提示段和历史重写破坏前缀 |
| `PresentationAdapters` | 分别处理 Native、Code、Both |
| `Telemetry` | 记录缓存稳定性、发现成本和失败原因，不记录正文 |

这些模块的外部接口应尽量小；协议选择、历史重建、能力检测和冲突降级应隐藏在模块实现中。

## 3. 缓存不变量

### 3.1 系统提示逐字节稳定

同一会话内，以下内容不得因普通工具目录变化而改变：

- 渐进披露规则；
- 发现工具定义；
- `run_code` 定义；
- eager 工具定义；
- Code SDK 的固定部分；
- Native 顶层工具数组；
- 已选择的 Shell 及其 SDK 定义。

禁止在系统提示中写入动态内容，例如：

```text
当前隐藏 37 个工具
当前有 6 个 Namespace
最近一次披露的是 github.create_issue
```

这些信息只能出现在新的工具结果或日志中。

### 3.2 披露只追加，不重写旧内容

```text
第 N 步：
[稳定前缀] [历史] [search 结果]

第 N+1 步：
[相同稳定前缀] [原历史 + search 结果] [describe 结果]

第 N+2 步：
[相同稳定前缀] [此前全部历史] [新的工具调用]
```

`describe_tools` 不得修改最初的工具数组或 SDK，只能在对应历史位置附加披露信息。

### 3.3 呈现不是授权

隐藏工具不等于无权执行，搜索也不等于解锁权限。

每次实际调用都必须重新经过：

- 当前作用域工具解析；
- Policy；
- Approval；
- Guards；
- 参数校验；
- 超时和调度。

## 4. Native、Code 与 Both 呈现

### 4.1 Native：支持原生延迟披露

初始只暴露：

```text
search_tools
describe_tools
eager tools
```

流程：

```text
search_tools
  → describe_tools
  → 下一模型步骤使用精确工具名发起普通调用
```

插件从持久化历史重建成功的 describe 结果，在对应 tool-result 位置注入工具 Schema，不替换顶层工具数组。

### 4.2 Native Fallback：稳定 invoke_tool

如果模型线路不支持 OpenAI Responses Tool Search 或 Anthropic Tool References，则固定增加：

```text
invoke_tool({ name, arguments })
```

流程：

```text
search_tools
  → describe_tools
  → invoke_tool
```

`invoke_tool` 只是稳定传输工具，不是第二套 Code Runtime，内部直接委托当前 ToolRuntime。

能力在会话创建时确定。会话中途切换模型或 Gateway 元数据变化时，不从 `invoke_tool` 切换到原生引用，也不反向切换。

### 4.3 Code：紧凑 PTC SDK

线路上只保留 `run_code`，SDK 固定包含：

```ts
tools.search_tools(...)
tools.describe_tools(...)
// eager bindings，包括会话创建时选定的 Shell
```

推荐调用序列：

```ts
return await tools.search_tools({ query: "github pull request" })
```

然后：

```ts
return await tools.describe_tools({ names: ["github_list_pull_requests"] })
```

describe 结果必须成为 `run_code` 的外层整理输出，否则 PTC 会把它当作中间结果，模型无法看到 SDK 片段。

下一步再执行目标工具：

```ts
return await tools.github_list_pull_requests({
  owner: "example",
  repository: "example"
})
```

隐藏工具的 PTC Binding 可以正常存在，只是不预先把完整声明写进 SDK。呈现过滤不得同步裁掉执行绑定。

### 4.4 Both

固定暴露：

```text
run_code
search_tools
describe_tools
eager tools
```

不再需要 `invoke_tool`。模式及工具集合在会话创建时固定。

## 5. 发现工具接口

### 5.1 search_tools

输入：

```ts
{
  query?: string
  namespace?: string
  limit?: number
}
```

输出：

```ts
{
  results: Array<{
    name: string
    summary: string
    namespace?: string
    schemaHash: string
  }>
  total: number
  fallback: boolean
}
```

采用确定性的宽松词法搜索。保留零命中目录兜底，但允许配置：

```text
zeroMatch: "catalog" | "empty"
```

默认 `catalog` 优先保证召回；目录特别大时使用分页浏览，避免返回过多摘要。

### 5.2 describe_tools

输入：

```ts
{ names: string[] }
```

输出：

```ts
{
  tools: Array<{
    name: string
    description: string
    inputSchema: object
    outputSchema: object
    sdkExcerpt?: string
    schemaHash: string
  }>
}
```

不维护可变的 `revealedTools` 集合。披露状态完全由持久化的 describe 调用和结果重建。

## 6. Eager 工具与 Shell 选择

### 6.1 Eager 的含义

Eager 工具是会话开始时就向模型完整披露描述、输入/输出 Schema 和 SDK 定义的工具。Eager 不代表立即执行，也不代表绕过审批。

适合 eager 的工具：

- 大多数会话都会使用；
- 名称和 Schema 稳定；
- 简单任务需要直接使用；
- 可避免额外 search/describe 轮次。

根据本机历史会话统计，可优先考虑：

- `bash`：覆盖 76% 会话；
- `read`：覆盖 53.1% 会话；
- `grep/glob`：承担代码发现；
- `edit/write`：调用量大但集中于修改型会话，可默认延迟或按 Preset 预载；
- Browser、`ego_*`、低频 MCP 和 `read_image` 优先延迟加载。

Eager 列表只能由部署配置或 Preset 决定，不能根据最近调用频率在会话中自动调整。配置变化只影响新会话。

### 6.2 Shell 角色解析

不能跨平台把 `bash` 写死为 eager。新增独立配置：

```yaml
shellTool: auto   # auto | bash | pwsh | none
```

`SurfaceManager` 在会话创建时将 Shell 角色解析为实际工具，并把其完整定义加入本会话表面。

自动选择优先级：

1. Profile/Preset 的显式配置；
2. 当前作用域实际注册且允许使用的 Shell；
3. 平台默认值：Windows 优先 `pwsh`，Linux/macOS 优先 `bash`；
4. 平台首选不可用时，使用唯一可用的另一种 Shell；
5. 两者都不可用时，不预载 Shell，允许通过发现机制查找其他执行工具。

不能只根据 `process.platform` 判断，因为 Windows 可能同时使用 PowerShell 和 Bash/WSL，Linux 也可能使用 PowerShell，工具还可能被 Policy 禁用。

手动选择适用于：

- Windows 上明确使用 Bash/WSL；
- 固定命令语法、远程环境或容器；
- Shell 兼容性测试；
- 确定性 A/B 测试。

显式选择 `bash`/`pwsh` 但工具不可用时，应明确报配置错误，不静默替换。Auto 模式没有可用 Shell 时，不应导致整个插件加载失败。

`shellTool: none` 表示不将 Shell 作为 eager，而不是禁用 Shell；模型仍可搜索、描述并调用它。

无论自动还是手动选择，Shell 都只能在会话创建时确定。会话中途不得从 Bash 切换为 PowerShell，因为工具名、Schema、SDK 和命令语法都会变化。设置变更只影响新会话。

设置页可提供高级选项：

```text
Shell 预载：自动 / Bash / PowerShell / 不预载
```

## 7. 缓存守卫

### 7.1 CodeSdkGuard

- 按会话冻结 SDK 文本；
- 非 eager 工具注册、注销、限制不改变 SDK；
- describe 得到的新 SDK 片段只追加到历史；
- 插件升级不影响已打开会话。

### 7.2 PlanModeGuard

宿主允许接管相应呈现时：

- Plan 工具保持固定注册；
- 不通过条件 `when` 增删工具；
- Plan 指引在进入模式时作为尾部通知追加；
- 能否执行由运行时状态判断。

如果存在另一个 Plan Mode 呈现所有者，不静默覆盖，进入冲突降级。

### 7.3 HistoryGuard

缓存敏感线路默认禁止：

- 修改旧工具结果正文；
- 中部删除历史；
- 重写旧 describe 结果；
- 重排工具声明。

大结果应在首次产生时生成有界预览和引用，而不是之后再修改旧结果。

Compaction 是显式例外：它建立新的 `cacheEpoch`，不得宣称压缩前后仍能继承原缓存。

### 7.4 ConflictGuard

检测：

- 另一个插件也在改写 `tools:sdk`；
- 另一个呈现所有者动态增删工具；
- 独立 `tool:*` Guidance 持续变化；
- pi-ai 内部对象形态不符合预期。

默认降级策略：

```text
Native 原生引用失败 → invoke_tool
Code 呈现冲突 → 保留已有 run_code，禁用本插件的 SDK 重写
无法保证稳定 → 禁用插件并发出明确告警
```

不能允许两个插件交替覆盖提示词。

## 8. Schema、路由和运行时变化

### Schema 变化

`describe` 返回 `schemaHash`。执行时：

- 当前 Schema 一致：正常执行；
- 不一致：返回 `TOOL_SCHEMA_CHANGED`，要求重新 describe；
- 工具被删除或限制：返回实时 ToolRuntime 的原因；
- 新 describe 仍然只追加，不修改旧披露。

### 模型路由变化

会话内固定：

- Native 引用或 `invoke_tool` 的选择；
- Code/Both 模式；
- eager 工具集合；
- 实际 Shell；
- Discovery 协议版本。

路由变化可以影响模型质量和缓存是否命中，但不能改变工具呈现协议。

## 9. 配置示例

```yaml
- id: stable-progressive-tools
  name: dsh-stable-progressive-tools
  config:
    activation:
      enabledPresets: [stable-ptc-eval]  # 验证后可改为 ptc 等已支持 Preset
      includeSubagents: false

    eagerTools: [read, grep, glob]
    shellTool: auto

    maxSearchResults: 10
    maxDescribeTools: 5
    maxSummaryChars: 240
    maxQueryChars: 500
    maxResultBytes: 1048576
    zeroMatch: catalog

    native:
      fallback: invoke_tool

    cache:
      scope: session
      freezeCodeSdk: true
      stablePlanMode: true
      preserveHistory: true
      onConflict: fallback

    telemetry:
      logQueries: false
      sampleSuccessRate: 0.1
```

普通 eager 工具如果声明后仍不可用，应在会话创建时明确报配置错误。Auto Shell 是例外：没有可用 Shell 时只跳过预载，不使插件失败。

## 10. 日志与观测

建议新增元数据事件：

- `disclosure/session-open`：模式、SurfaceHash、CacheEpoch、Shell 角色和实际选择；
- `disclosure/search`：结果数、是否目录兜底、耗时；
- `disclosure/describe`：工具名、SchemaHash、返回字节数；
- `disclosure/schema-change`：工具名和新旧 Hash；
- `disclosure/fallback`：降级原因；
- `disclosure/surface-conflict`：冲突所有者和处理结果。

默认不记录查询正文、工具参数和结果正文。成功发现可采样，冲突、降级和错误全部记录。

日志中的 Shell 选择只记录 `auto/bash/pwsh/none` 与实际工具名，不记录命令正文。

## 11. 测试计划

### 单元与契约测试

- 非 eager 工具注册、注销、限制前后，固定提示逐字节相同；
- search/describe 不改变初始工具数组或 SDK；
- Native 历史重建把 Schema 注入正确 describe 位置；
- Code describe 结果确实进入外层模型可见输出；
- 后续 PTC 程序能调用已 describe 的隐藏工具；
- 隐藏工具不能绕过审批、Policy 和参数校验；
- SchemaHash 变化触发可重试错误；
- 模型路由变化不改变会话呈现模式；
- 工具名、摘要、查询和结果限制正确处理极端输入。

### Shell 测试矩阵

| 平台/注册状态 | auto 预期 |
|---|---|
| Windows，仅 pwsh | pwsh |
| Windows，bash + pwsh | pwsh |
| Windows，仅 bash | bash |
| Linux，仅 bash | bash |
| Linux，bash + pwsh | bash |
| Linux，仅 pwsh | pwsh |
| 无 Shell | 不预载，插件继续工作 |
| 显式 pwsh，但未注册 | 明确配置错误 |
| shellTool=none | 不预载，仍允许发现 |

另需验证：同一会话内 Shell 永不改变；新会话可以采用新配置；PTC 示例和 SDK 只包含实际选定的 Shell。

### 冲突与降级测试

- pi-ai 内部结构变化后回退 `invoke_tool`；
- 其他插件改写 SDK 时不会形成双重覆盖；
- Plan Mode 呈现冲突有明确告警；
- HistoryGuard 不静默改写旧结果；
- Compaction 正确建立新 CacheEpoch。

## 12. 分阶段实施与 A/B 验收

### P0：Code MVP

- 建立独立 `stable-ptc-eval` Preset，与当前 PTC 使用相同模型、工具和运行时；
- 固定 Code SDK；
- search/describe；
- describe 外层输出；
- PTC Binding 实时执行；
- Shell 角色解析；
- 字节稳定契约测试。

### P1：稳定 Native Fallback

- search/describe/invoke_tool；
- 权限管线；
- Schema 变化处理；
- 暂不接入 pi-ai 内部桥接。

### P2：原生工具引用与缓存守卫

- 原生 describe 历史注入；
- PlanModeGuard；
- HistoryGuard；
- 冲突检测和降级。

### P3：Both 与真实 A/B

固定模型、任务和工具目录，对比当前 PTC 与新插件，测量：

- 缓存及非缓存输入 Token；
- 实际计费；
- 发现额外轮次；
- Search Recall@5；
- 首次工具命中率；
- 参数合法率；
- 最终任务通过率；
- p50/p95 延迟；
- 不同 Shell 下的失败率。

建议放量门槛：

- 非 Compaction 场景前缀稳定测试 100% 通过；
- Search Recall@5 ≥97%；
- 任务通过率回退不超过 2 个百分点；
- 实际成本下降至少 15%；
- 简单任务允许直接使用 eager 工具，避免强制搜索；
- Shell 自动选择错误不得导致数据修改或权限扩大。

回滚通过移除 bundle 恢复原呈现。由于不维护可变 reveal 集合，回滚不需要迁移 reveal 状态；已打开会话应保持原插件实例直至结束，新会话使用回滚后的配置。

## 13. 最终设计判断

该方案的主要价值不是单纯减少工具定义，而是同时做到：

- 初始上下文小；
- 高频工具无需发现；
- 后续披露只追加；
- 动态目录不改前缀；
- Shell 能随平台正确选择且在会话内稳定；
- 呈现与授权彻底分离；
- 能力退化和插件冲突有稳定回退路径。
