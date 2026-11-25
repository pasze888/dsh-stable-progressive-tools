# dsh-stable-progressive-tools

DeepSeek Harness 的会话稳定渐进式工具披露插件骨架。

设计依据：[`../research/dsh-stable-progressive-tools-design.md`](../research/dsh-stable-progressive-tools-design.md)。

## 当前状态

**这是基础骨架，不是可用的工具披露实现。** 当前 Cordis 入口只解析并校验配置，不修改 Native 工具数组、PTC SDK、Plan Mode 或历史消息。安装后不会改变模型行为。

已经实现并测试的纯逻辑：

- 按 Preset 和 Agent 来源决定是否启用；
- 会话级 Surface 创建、冻结、查询和释放；
- Bash/PowerShell 的自动、手动和不预载选择；
- 同会话重复打开时复用同一 Surface；
- SurfaceHash 与 CacheEpoch 生成；
- 配置默认值、重复项和数值预算校验；
- Discovery、Invocation、Presentation Adapter 和 Telemetry 接口。

尚未实现：

- `search_tools` / `describe_tools` 的真实工具注册；
- Native 原生工具引用或 `invoke_tool` 兜底执行；
- Code/Both 的真实呈现适配器；
- PTC SDK 改写、Plan Mode 和历史缓存守卫；
- DSH 宿主集成测试与真实模型 A/B。

## 项目结构

```text
src/
  index.ts             Cordis 入口与 SurfaceManager 工厂
  config.ts            配置接口、默认值和校验
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
```

## 配置预览

```yaml
- id: stable-progressive-tools
  name: dsh-stable-progressive-tools
  config:
    activation:
      enabledPresets: [stable-ptc-eval]
      includeSubagents: false
    eagerTools: [read, grep, glob]
    shellTool: auto  # auto | bash | pwsh | none
    maxSearchResults: 10
    maxDescribeTools: 5
    zeroMatch: catalog
    cache:
      scope: session
      freezeCodeSdk: true
      stablePlanMode: true
      preserveHistory: true
      onConflict: fallback
```

Shell 只在会话创建时解析。Auto 模式按当前可用工具和平台选择；显式选择不可用的 Shell 会报配置错误；`none` 仅表示不预载，不会禁止后续发现。

## 开发

```sh
npm install
npm run check
```

`npm run check` 包含 TypeScript 类型检查、ESM 构建和 Vitest 测试。当前基线为 **3 个测试文件、15 项测试**。

## 下一步

1. 在 P0 中仅实现 Code 模式，并接入独立 `stable-ptc-eval` Preset；
2. 为真实 `run_code` 外层 describe 输出和隐藏 PTC Binding 添加宿主契约测试；
3. 再实现稳定 `invoke_tool`，最后接 Native 原生引用；
4. 完成缓存守卫后再启用 Plan Mode 和历史保护；
5. 通过设计文档中的 A/B 门槛前，不扩展到其他 Preset。
