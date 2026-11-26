# dsh-stable-progressive-tools

DeepSeek Harness 的会话稳定渐进式工具披露插件。

设计依据：[`../research/dsh-stable-progressive-tools-design.md`](../research/dsh-stable-progressive-tools-design.md)。

## 当前状态

当前实现是 **P0 Code/PTC 工程原型**。插件只挂载在独立的 `stable-ptc-eval` Agent preset 中；普通 `ptc` preset 不安装插件，子 Agent 默认按会话来源排除。

在评估 preset 中，模型直接调用的工具仍只有 `run_code`，但其 TypeScript SDK 只包含：

- `search_tools`：查询当前 Tool Catalog；
- `describe_tools`：按准确名称返回完整描述、输入/输出 Schema、SDK 片段和 SchemaHash；
- 配置的 Eager Tools；
- 会话创建时选定的 Bash 或 PowerShell。

其他工具不出现在初始 SDK 中，但仍可通过实时 PTC Binding 调用。披露不等于授权；隐藏工具的每次执行仍经过当前 ToolRuntime、Policy、Approval、Guards 和参数校验。

## 已实现的契约

- 在 `system-prompt/assemble` 中整体替换 `tools:sdk`，不包装或替换 PTC Executor；
- 会话内复用深度不可变的 Surface，非 Eager 工具后续注册不会改变 SDK 字节；
- Eager 声明包含完整输入/输出 Schema；不可用或重复的配置会明确失败；
- Surface 创建失败时不发布部分 Surface，也不向模型发出改写后的请求；
- Shell 按显式配置、实际可用性和平台偏好解析；`none` 只禁止预载，不禁止发现或调用；
- SurfaceHash 覆盖规范化声明、SDK、固定指引、协议版本、Eager Tools 和 Shell 状态；
- Describe 不设置插件自有数量、总字节、分页或截断限制。

真实 SDK 测试会启动隔离的 DSH 子进程，通过受控模型端点驱动 Search、Describe、隐藏工具、Shell、审批和父子 Agent 流程，并捕获实际模型请求。普通 `ptc` 对照测试验证安装评估 preset 前后的 `system` 与 `tools` 逐字节一致。

## 边界

P0 不包含 Native、Both、`invoke_tool`、Plan Mode 或通用 HistoryGuard，也不宣称完成真实模型 A/B、成本或质量验收。当前 Surface 保存于插件运行时内；跨进程恢复和 fork 继承不属于这三个实现票据的已完成范围。

## 项目结构

```text
src/
  index.ts             Cordis 入口与 SurfaceManager 工厂
  host.ts              Discovery 工具、实时 Binding 和 SDK 装配
  config.ts            P0 配置接口、默认值和校验
  shell.ts             会话创建时的 Shell 角色解析
  surface.ts           会话级不可变工具表面
  discovery.ts         搜索与描述模块接口
  invocation.ts        实时调用模块接口与 Schema 变化错误
  cache-guard.ts       Surface 连续性和 Compaction Epoch
  telemetry.ts         元数据事件接口
  adapters/types.ts    呈现适配器接口
tests/
  config.test.ts
  shell.test.ts
  surface.test.ts
  ptc-sdk.test.ts      官方 SDK + 真实 DSH 子进程契约测试
  fixtures/            受控模型响应、preset 驱动和工具 fixtures
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
```

preset 成员关系就是启用机制，没有 `activation.enabledPresets`。Shell 只在 Surface 创建时解析；显式选择不可用的 Shell 会报错，Auto 模式没有可用 Shell 时继续运行但不预载。

## 开发

```sh
npm install
npm run check
```

`npm run check` 包含 TypeScript 类型检查、ESM 构建和完整 Vitest 测试。SDK 测试需要构建后的 `lib/index.mjs`，并启动多个真实 DSH 子进程，因此运行时间明显长于纯逻辑测试。

## 后续

1. 在独立验收阶段实现跨重启恢复、fork 继承和完整 Schema 历史关联；
2. 评估 Search 分页、Schema 变化与更多权限失败路径；
3. 再考虑稳定 `invoke_tool`、Native 原生引用和缓存守卫；
4. 通过设计文档中的真实 A/B 门槛前，不扩展到其他 preset。
