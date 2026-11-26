# dsh-stable-progressive-tools

DeepSeek Harness 的会话稳定渐进式工具披露插件。

设计依据：[`docs/adr/0001-preset-scoped-stable-progressive-tools.md`](docs/adr/0001-preset-scoped-stable-progressive-tools.md)，其中包含已接受的设计决策和原始设计附录。

## 当前状态

当前实现是 **P0 Code/PTC 工程原型，已完成工程验收**，不代表生产放量建议。插件只挂载在独立的 `stable-ptc-eval` Agent preset 中；普通 `ptc` preset 不安装插件，子 Agent 默认按会话来源排除。

在评估 preset 中，模型直接调用的工具仍只有 `run_code`，但其 TypeScript SDK 只包含：

- `search_tools`：查询当前 Tool Catalog，支持有界结果和一致游标；
- `describe_tools`：按准确名称返回完整描述、输入/输出 Schema、SDK 片段和 SchemaHash；
- 配置的 Eager Tools；
- 会话创建时选定的 Bash 或 PowerShell。

其他工具不出现在初始 SDK 中，但仍可通过实时 PTC Binding 调用。披露不等于授权；隐藏工具的每次执行仍经过当前 ToolRuntime、Policy、Approval、Guards 和参数校验。

## 已实现的契约

- 在 `system-prompt/assemble` 中整体替换 `tools:sdk`，不包装或替换 PTC Executor；
- Surface 深度不可变，非 Eager 注册、删除和 restriction 不改变 SDK 字节；
- Eager 声明包含完整 Schema；无效配置在任何模型请求前明确失败；
- Shell 按显式配置、实际可用性和平台偏好解析；`none` 只禁止预载；
- SurfaceHash 覆盖规范化声明、SDK、固定指引、协议版本、Eager Tools 和 Shell 状态；
- Describe 不设插件自有数量、总字节、分页或截断限制；宿主或 Provider 错误保持失败；
- Describe 的持久化 metadata 关联最新 SchemaHash；过期 Hash 返回可重试的 `TOOL_SCHEMA_CHANGED`，重新 Describe 后可重试；
- 未披露调用不需要 Describe，也没有额外 Hash 参数；删除、restriction 和无效参数保留当前运行时行为；
- 完整 Surface 以 DSH home 下的原子 JSON 记录持久化，进程重启、SDK resume 和 fork 恢复原 Surface 与披露历史；
- Surface 创建和恢复在 Agent 创建/恢复生命周期完成，普通模型装配不执行文件 I/O；
- Compaction 只推进 Cache Epoch，不改 Surface 字节或 SurfaceHash；普通装配不推进 Epoch；
- 写入失败会回滚未提交的内存 Surface，后续装配可重试；close 不删除恢复记录；
- rollback 后的新会话恢复普通 PTC，已打开的 Surface 不变；
- Telemetry 按 Session 写入 DSH home 下的 metadata-only JSONL，不记录查询、参数或结果正文；
- 成功采样只影响 Search/Describe；error、fallback、conflict 和 Schema-change 始终记录；
- 离线 Recall@5 使用固定标注数据集，并与生产 Search 共用词法排序实现。

## 验收

真实 SDK 测试启动隔离的 DSH 子进程，以受控模型端点驱动并捕获实际请求，覆盖：

- Search、Describe、隐藏执行、权限和 Shell；
- 实时目录变化、游标和错误；
- resume、fork、Compaction 和 rollback；
- Telemetry 字段、采样、隐私和离线 Recall@5；
- 普通 PTC 与子 Agent 的普通基线逐字节对照。

这些结果只证明 P0 工程契约，不证明真实模型的成本、质量、延迟或任务通过率。

## 边界

P0 不包含 Native、Both、`invoke_tool`、Plan Mode 稳定化或通用 HistoryGuard。真实模型 A/B 和放量门槛属于后续阶段。

## 项目结构

```text
src/
  index.ts                Cordis 入口与公共工厂
  host.ts                 Discovery、实时 Binding、Schema Guard 和装配
  config.ts               P0 配置与校验
  shell.ts                Shell 角色解析
  surface.ts              不可变 Surface、恢复校验和 Epoch 更新
  surface-history.ts      Session 历史与 Compaction projection
  surface-store.ts        原子 Surface 恢复记录
  disclosure-history.ts   最新 Describe SchemaHash projection
  discovery.ts            Search 接口与共享词法排序
  search-recall.ts        固定数据集的离线 Recall@5
  invocation.ts           调用接口与 Schema 变化错误
  cache-guard.ts          Surface 连续性检查
  telemetry.ts            metadata-only JSONL Telemetry
  adapters/types.ts       呈现适配器接口
tests/
  config.test.ts
  shell.test.ts
  surface.test.ts
  search-recall.test.ts
  ptc-sdk.test.ts         官方 SDK + 真实 DSH 子进程验收
  fixtures/               模型响应、preset、生命周期和工具 fixtures
```

## 配置

```yaml
- id: stable-progressive-tools
  name: dsh-stable-progressive-tools
  config:
    activation:
      includeSubagents: false
    eagerTools: [read, grep, glob]
    shellTool: auto  # auto | bash | pwsh | none
    maxSearchResults: 10
    maxSummaryChars: 240
    maxQueryChars: 500
    zeroMatch: catalog
    telemetry:
      sampleSuccessRate: 0.1
```

preset 成员关系就是启用机制，没有 `activation.enabledPresets`。Shell 只在 Surface 创建时解析；显式选择不可用的 Shell 会报错，Auto 模式没有可用 Shell 时继续运行但不预载。

Telemetry 文件位于 `DSH_HOME/stable-progressive-tools/telemetry/<base64url-session-id>.jsonl`。它是非权威观测记录，写盘失败不改变 Session 的工具结果。

## 开发

```sh
npm install
npm run check
```

`npm run check` 包含 TypeScript 类型检查、ESM 构建和完整 Vitest 测试。SDK 测试需要构建后的 `lib/index.mjs`，并启动多个真实 DSH 子进程，因此运行时间明显长于纯逻辑测试。

## 后续

1. 在后续阶段实现 Native、稳定 `invoke_tool` 或其他呈现协议；
2. 通过真实模型 A/B 评估成本、质量、延迟、Recall 和任务通过率；
3. 达到设计门槛前，不扩展到其他 preset，不把 P0 工程验收当作生产放量证明。
