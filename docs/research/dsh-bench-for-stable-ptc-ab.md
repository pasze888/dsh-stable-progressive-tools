# DSH-Bench 1.1.0 能否用于 stable-ptc-eval 的 A/B：源码核验与改造评估

- 调研日期：2026-11-27（Asia/Shanghai）
- 范围：父目录 `/home/lz/dev/dsh-bench-1.1.0`（VERSION 1.1.0）源码、overlays、config 模板、manifest/tasks、docs；本仓库 cordis.patch.yml / README / ADR 0001 / src；本机 DSH 源码 checkout `/home/lz/dev/deepseek-harness-dsh-v0.2.2-rc.2` 与安装版 `/home/lz/.npm-global/lib/node_modules/@deepseek-ai/dsh`（0.2.2-rc.2）。
- 方法声明：**只读源码核验**，未修改 dsh-bench，未修改本仓库任何既有文件（本笔记除外），未运行真实模型，未下载数据集，未执行 `npm install` / `pip install` / 任何联网命令。本机 python3 没有 PyYAML，所以 `preset_fidelity.py` 无法在此就地运行（见 §7 待验证）。
- 标记约定：**事实** = 一手源码/官方文档可直接支持（带编号来源）；**判断** = 面向本仓库的适配建议与证据强度评价；**待验证** = 需运行或本机不可得。

## 1. 结论先行

> **2026-11-27 定稿口径：** 本机探针已证实 headless **无需改 DSH 本体**即可通过 ~20 行 preset driver 挂载真实 preset（见 §1.2）。另经 `gh` 核实：本笔记调研的对象 `/home/lz/dev/dsh-bench-1.1.0` 对应 **`LarryE135/dsh-bench`**；而 **`TT-Wang/dsh-eval-infra`** 是另一独立仓库（其 `peerDependencies` 停留在 `@deepseek-ai/dsh-sdk-client ^0.1.0-rc.1 || ^0.1.2-rc.1`，与当前 `0.2.2-rc.2` 跨大版本，已决策放弃）。

**判断（一句话）：dsh-bench 1.1.0 不能开箱直用于"preset 对照"的 A/B，但通过 ~20 行 `preset-driver` 补丁在 headless 中挂载真实 preset，并补齐代理前缀采集与机制聚合（3–5 处小改造）后，可以作为"任务通过率 + token/成本"的主实验台；机制指标（生产目录 Recall@5、精确首工具命中、非法参数合法率、正确拒答率）与安全负例必须在本仓库另建。**

分项结论：

1. **事实：dsh-bench 的默认臂不是 preset，而是"把 preset 翻译成顶层覆盖层行"。** 每次运行执行 `dsh --profile <臂profile> --patch … --json "<题面>"`，没有 `--preset` 参数；`arms.<臂>.preset` 只被用来跑保真检查。这也是 `dsh-flash-presets` 使用 dsh-bench 时的同样做法（通过 `preset_fidelity.py --preset-file` 比对摊平后的顶层行）。[DB1][DB2][DSH1]
2. **事实：0.2.2-rc.2 的 headless 组合包默认不组合 preset roster，但只拒绝 _resume_ 带 preset id 的会话。** 在 profile 补丁里 insert `agent-preset-registry` + 约 20 行的 `preset-driver`（包装 `agents.create/resume` 在 root session setup 中 `agentPresets.mount(ctx, presetId)`）+ 预设定义补丁后，headless 新会话即可原生按真实 preset 组合（见 §1.2 实测）。[DSH2][DSH3][DSH4][DSH5]
3. **事实：本插件的效果完全落在 `tools:sdk` 段的字节里，而 dsh-bench 的金丝雀/保真检查都只看顶层配置行。** 现有判据既看不见 SDK 字节，在真实 preset 挂载下还会因执行器行在 preset 子树内而误报 `ptc=false` / `mismatch`，必须改造为"预设文件检查 + 首请求 `sys_chars`/`sys_sha256`/`tools_sha256` 与 `search_tools` 存在性断言"。[DB3][DB4][P1]
4. **判断：不能直接只叠本仓库 `cordis.patch.yml`。** 缺少 `agent-preset-registry` + `preset-driver` 时 preset 行会挂起不生效；采用两份补丁（`preset-runtime-<id>.yml` + 预设定义补丁）即可直接挂载真实 preset，host-plane 等效装配仅保留作退路。[DSH6][P2]
5. **判断：dsh-bench 原生只覆盖 ADR 指标体系里的通过率、三类 token/估算成本与粗粒度延迟，其余机制指标与安全负例必须靠 `tool/ptc-dispatch` 解析及本仓库自建套件补齐；且 104 题规模下单侧 95% CI 证明 2pp 不可达，需要两道门策略（先 5pp 过筛，再决定是否扩样冲 2pp）。** 见 §1.1 与 §7。

### 1.2 实测补充（2026-11-27，本机 headless 探针；晚于 §2.2 的架构推断）

**事实：headless 可以挂真实 preset，不需要改 DSH。** 在 profile 补丁里 insert `agent-preset-registry` + 一个小 driver（本仓库 `tests/fixtures/preset-driver.mjs`，约 20 行：包装 `agents.create/resume`，在 root session 的 setup 里 `agentPresets.mount(ctx, presetId)`），再 insert 预设行，headless 新会话即按 preset 组合。实测：

| 臂 | 覆盖层 | 首请求 system 字符 | search_tools | 说明 |
|---|---|---|---|---|
| 对照：出厂 `ptc` preset | `preset-runtime-ptc.yml` + 安装版 `@deepseek-ai/dsh-web-app/presets/ptc.patch.yml` | **31,415** | 否 | 真实 preset 组合 |
| 实验：`stable-ptc-eval` | `preset-runtime-stable.yml` + 本仓库 `cordis.patch.yml`（插件名改 `file://` 绝对路径） | **8,960** | 是 | 同上，仅 preset 不同 |

命令形如 `dsh --profile probe --patch preset-runtime-stable.yml --patch stable-preset.yml --patch route.yml --json "ok"`（`route.yml` 把 `llm-deepseek.baseURL` 指向本地捕获端点，`DEEPSEEK_API_KEY=dummy`）。不需要 `--preset`、不需要额外 `ptc.yml`（preset 自带 `tool-executor-ptc` 行）、不需要 web-app profile。

**判断：** §2.2 的"不可表达"应改为"默认不表达"：headless 只拒绝 **resume** 带 preset id 的会话（`packages/bundle/headless/src/index.ts:200-235`），dsh-bench 每题新会话，不受影响。该路线比 §3.2 的 host-plane 等效装配更忠实（preset 内工具行、persona、执行器均原样挂载），改动更小。代价：a) `--dump-config` 只显示 preset 行本身，`bench.py` 的 `ptc_on()` 看顶层执行器行会判 false；b) `preset_fidelity.py` 把 preset 子行与顶层 dump 比，真实挂载时子行不在 dump 里，会判 mismatch。金丝雀与保真检查须改为"读预设文件 + 抓首次请求的 system 字节与 `search_tools` 存在性"。

**副作用测量（量级）：** 在 web-ptc 组合 + 同一 preset 行（插件行删/留）下，首请求 system 为 59,940 vs 10,828 字符（评测 preset 目录约 25 个工具）；headless base 目录较小，对应 31,415 vs 8,960。两者都说明披露节省主要落在 system 前缀的绝对字节（约 19k–49k 字符/请求）。

**统计功效（用它自带的 `sample_size.py` 先验分布实测，n=104）：** margin=2pp 时 r=3/6/10/34 的功效为 0.10/0.15/0.21/0.62；margin=3pp 为 0.17/0.30/0.45/0.94；margin=5pp 为 0.42/0.68/0.87/1.00。ADR 的 2pp 门槛在当前题量下不可达。

### 1.1 指标覆盖矩阵（面向 ADR 0001 §12 P3 清单）

| ADR 指标 | dsh-bench 原生 | 可得但需扩展 | 必须另建 | 依据 |
|---|---|---|---|---|
| 最终任务通过率 | **是**（104 主测，18 个判分器，全客观） | — | — | [DB5][DB6] |
| 缓存/非缓存输入 token | **是**（三类 token 逐请求记账） | — | — | [DB7] |
| 实际成本 | **是**（按价表从 token 重算，高峰价） | 需把"≥10%"写成单侧 95% 配对 CI 判据，并与 Provider 实际账单 CSV 交叉核对 | — | [DB7][DB8] |
| p50/p95 延迟 | 只记单次 `wall_s`，且含并发排队 | 用代理 `dur_s` + `wall_s` 派生分位 | 严格分位需单槽串行 | [DB9][DB10] |
| 发现额外轮次 | 否 | 从会话日志 `tool/ptc-dispatch` 数 search/describe 次数与步号 | — | [DSH7][DB11] |
| Search Recall@5（生产目录） | 否 | 否 | **是**（本仓库已有离线 `search-recall.ts` 固定数据集） | [P3] |
| 首次目标工具命中率 | 否 | 从 dispatch 序列派生（需定义"目标工具"标注） | 标注集需自建 | [DSH7] |
| Describe 成功率 | 否 | 从 dispatch 的 `isError`/`error` 派生 | — | [DSH7] |
| 参数合法率 | 否（判分只判最终产物） | 部分（dispatch 的 `isError` 是粗代理） | **是**（需要"故意非法调用"任务族） | [DSH7] |
| 正确拒答率 | 否 | 否 | **是**（需要无工具/缺参负例题族） | [DSH8] |
| Shell 失败率 | 间接（任务失败里混着） | 否 | 否（另立矩阵） | [DB5] |

> **判断：** 这张表是"能否用"的核心。dsh-bench 的回答面是"同样的题、同样的判分，换工具面后通过率与费用怎么变"；它**不回答**"渐进披露的发现机制是否可靠"。把两者混成一个结论会同时高估 dsh-bench（以为它测了 Recall）和低估本插件（以为通过率不变就等于设计无效）。

## 2. 臂装配机制（问题 A）

### 2.1 事实

- **事实：一次运行 = 一个 headless 进程 + 一个臂 profile + 三层覆盖层。** env 模式命令为 `dsh --profile <prof> --patch <1.yml> … --patch <route.yml> --json "<题面>"`；docker 模式结构相同，参数在容器内。[DB1][DB2]
- **事实：覆盖层顺序 = `common_patches` → `arms.<臂>.patches` → 自动生成的"本次运行"层（模型 baseURL 指代理、session/storage 指本次目录）。** 后层胜。[DB2]
- **事实：`arms.<臂>.preset` 不进入命令行。** 它只出现在 `setup` 里调用 `preset_fidelity.py --preset <id>`，以及写进 `runs/_setup/setup.json`。[DB3]
- **事实：`arms.<臂>.profile` 是"臂 → profile 名"的覆盖值；默认由 setup 随机生成中性名（`p`+`6` 位十六进制），映射只存在 `runs/_setup/profiles.json`。两臂默认不同 profile；同一 profile 被两臂复用但插件列表不同会直接 `SystemExit`。[DB12][DB13]
- **事实：`arms.<臂>.plugins` 会真的执行安装。** setup 为每个 profile 建一次 headless 模板，然后逐条 `dsh plugin --profile <prof> add <pl>`（超时 1200 s），失败即中止 setup。[DB14] docker 模式在一次性有网容器里执行同一串命令。[DB15]
- **事实：安装目标是**该臂 profile 的 `node_modules`**，不是共享 DSH_HOME 的全局位置；但 `DSH_HOME` 本身是**两臂共用**的一个目录（`~/.local/share/wh`，docker 为 `wh-linux`）。[DB12][DB16]
- **事实：0.2.2-rc.2 的 launcher 只有 `--profile`、`--from-default-profile`、`--patch`（可重复）、`--dump-config`、`--dump-config-schema`、`--dump-default-config`；**没有 `--preset`。** `dsh plugin` 是 pnpm 转发器。[DSH1]

### 2.2 判断：两臂能否各用不同 preset id？

**判断：默认不能，但借助 ~20 行 `preset-driver` 补丁可以忠实实现，无需改动 DSH 本体。** 证据链：

1. **事实：headless 组合包默认不含 preset 基础设施**（只有 `system-prompt`、`headless-startup`、`headless-runner`、`sandbox-policy`、`hmr`、`credentials`/`authorization`/`deepseek-account`），不含 `agent-preset` 与 `agent-preset-registry`。[DSH2]
2. **事实：出厂只有 web-app 组合包声明 preset roster**：`agent-preset-registry` 行（`default: standard`）与 `dsh.bundle.patch` 里列出的 `presets/{standard,ptc,minimal,cordis}.patch.yml`。[DSH3][DSH4]
3. **事实：headless runner 仅在 _adopt/resume_ 已有会话时拒绝带 preset id 的会话**（报 `runs under agent preset "<id>", which the one-shot runner does not compose`）；新建会话调用 `agents.create({ meta: { cwd }, … })`，而 dsh-bench 每题都是全新会话，不触发 adopt 分支。[DSH5]
4. **事实：`@deepseek-ai/dsh-agent-preset` 类 `static inject = ['agentPresets']`**，如果只叠加预设文件而不提供注册表与挂载驱动，preset 行会挂起不生效。[DSH6]

**判断（已实测验证的推荐路线）：**
- **首选：headless + 真实 preset driver 路线**。每臂叠加两份补丁：① `preset-runtime-<id>.yml`（顶层 insert `@deepseek-ai/dsh-agent-preset-registry` 与约 20 行的 `preset-driver`，复用本仓库 `tests/fixtures/preset-driver.mjs` 机制在 root session setup 里调用 `agentPresets.mount(ctx, presetId)`）；② 对应预设定义补丁（对照臂用出厂 `ptc.patch.yml`，实验臂用本仓库 `cordis.patch.yml`）。这样两臂完整工具目录、persona、compaction、tool-result-pruner、PTC 执行器全部按真实 preset 挂载，唯一变量是 `stable-progressive-tools` 一行（实测见 §1.2）。
- **退路：host-plane 摊平装配**（即 `dsh-bench` 与 `dsh-flash-presets` 原先采用的方式：把 preset 子行手工翻译成顶层 overlay 行，再加顶层 `stable-progressive-tools`）。仅在真实 preset driver 遇到未预见兼容问题时启用。
- **补充说明（关于 `dsh-flash-presets`）**：`dsh-flash-presets` 同样受限于 headless 不选 preset，它通过将预设规则与参数摊平为顶层 overlay + `preset_fidelity.py --preset-file` 校验来绕过。`preset-driver` 路线对 flash 预设也同样适用，且对本项目这种"运行时改写 `tools:sdk`"的插件更忠实。

## 3. 插件/preset 注入（问题 B）

### 3.1 事实：patch 的 insert 语义在 rc.2 里成立

- **事实：`--patch` 文件必须是顶层 YAML 数组的 loader patch 列表，支持"按 id 覆盖"与 `insert` 列表；文件缺失/不可解析/非数组 → 启动即抛错，不静默跳过。**[DSH9]
- **事实：`insert` 里的插件名如果是绝对路径、`./` 或 `../` 开头，会被锚定到 patch 文件所在目录并转成 `file://` URL；裸包名保持字面量。** 因此"用相对路径指向本地插件目录"是被支持的。[DSH10]
- **事实：单条 patch 找不到目标行时只是 Loader 警告（`patch: entry "…" not found`），不是启动失败。** dsh-bench 正是靠扫这串字符串来抓"覆盖层被静默丢弃"。[DSH11][DB18]
- **事实：本仓库 `cordis.patch.yml` 的形态就是 `- insert: [ { id: preset-stable-ptc-eval, name: '@deepseek-ai/dsh-agent-preset', config: { id: stable-ptc-eval, order: 4, plugins: [ … ] } } ]`，插件行 `stable-progressive-tools` / `name: dsh-stable-progressive-tools` 在 `config.plugins` 内部。**[P2]
- **事实：本仓库 package.json 声明 `dsh.bundle.patch: ./cordis.patch.yml`。** 因此用 `dsh plugin add` 装它时会被登记成 profile 的一个**组合包层**（`dsh.profile.bundles`），该层被应用到 profile 树；但被 insert 的只是一个 preset 行。[P4][DSH12]

### 3.2 判断：能不能直接把 cordis.patch.yml 当臂的 --patch？

**判断：单独叠加不行，但配上一份 ~10 行的 `preset-runtime-<id>.yml` 补丁即可直接挂载真实 preset。** 关键要点：

1. 只叠 `cordis.patch.yml` 时，headless 树里缺少 `agentPresets`，preset 行会挂起不生效（§2.2 第 4 条）。
2. 配上 `preset-runtime-<id>.yml`（insert `@deepseek-ai/dsh-agent-preset-registry` 与 `preset-driver`，指定 `presetId: stable-ptc-eval` 或 `ptc`）后，preset 内自带 `tool-executor-ptc`、完整工具目录与 `stable-progressive-tools`，**不再需要额外写 `tool-executor-native/ptc` 顶层切换补丁**（唯一控制项是在两臂预设或运行层统一禁用 `tool-web`）。
3. 插件的 `peerDependencies` 精确钉 `@deepseek-ai/*: 0.2.2-rc.2`，而 dsh-bench 默认把 `dsh_version_pin` 钉在 `0.2.2-rc.1`；评测配置必须对齐到 `0.2.2-rc.2`（本机已装 rc.2）。[P4][DB19][DSH14][DSH15]

**判断：推荐形态（真实 preset 挂载，每臂两份补丁）**：

```yaml
# 1) preset-runtime-stable.yml（对照臂仅把 presetId 改为 ptc）
- insert:
    - id: agent-preset-registry
      name: '@deepseek-ai/dsh-agent-preset-registry'
      config:
        default: stable-ptc-eval
    - id: preset-driver
      name: /abs/path/to/preset-driver.mjs
      config:
        presetId: stable-ptc-eval
```

再叠加第二份补丁：对照臂叠加出厂 `ptc.patch.yml`（禁 `tool-web`），实验臂叠加本仓库 `cordis.patch.yml`（禁 `tool-web`，且 `telemetry.sampleSuccessRate: 1`；包名可用 `file://` 指向构建产物 `lib/index.mjs` 或安装到该臂 profile 的 `node_modules`）。

**退路（仅当 preset-driver 路线受阻时）**：可在顶层 insert `stable-progressive-tools` 并切 `tool-executor-native: disabled: true` / `tool-executor-ptc: disabled: false`，但会损失完整 preset 工具目录对齐（headless base 目录较小，system 缩短量级会明显缩水）。

**事实（包如何进入解析路径）**：两种都被支持——(a) `dsh plugin --profile <prof> add <spec>` 装成 profile 依赖（`pnpm add`），裸包名从 profile `node_modules` 解析；(b) patch 里写相对/绝对路径，rc.2 会转成 `file://`，不需要 pnpm。[DB14][DSH10] 在 **env 软隔离模式**下 (b) 最简洁且零依赖漂移；在 **docker 模式**下 (b) 不可用（容器不挂载宿主机代码目录），需打包进 `DSH_HOME` 或 registry。[DB20][DB15]

## 4. 金丝雀与保真检查（问题 C）

### 4.1 事实：它们各自检查什么

| 检查 | 时机 | 判据 | 看不见什么 |
|---|---|---|---|
| 合成配置金丝雀 `canary` | `setup` | `expect.marker`+规则条数、`expect.ptc`（执行器 disabled 行或 `tool-presentation.mode: ptc`）、`mustHave`/`mustNot` 逐行子串、代理端口出现在配置里 | 运行时行为、system prompt 文本、插件是否挂载成功 |
| 启动探针 `boot_probe` | `setup` | 真的拉起一次，只走到"要连模型"；命中 `invalid config`/`patch: entry`/… 即失败 | 同上 |
| 预设保真 `preset_fidelity` | `setup` | 把预设的每一行与 `--dump-config` 的合成树**逐行**比：`disabled`、`config.*` 键值；`persona`→`system-prompt.personaPrefix/Suffix` 与 PTC 开关算"等价翻译"；`WEB_ONLY` 允许缺席；其余缺席判 mismatch（非零退出） | **完全不看 system prompt 文本**；不看插件是否真的改写了任何段 |
| 冒烟 `smoke` | `smoke` | 每臂 2 题跑通、代理有 token、服务端模型名匹配、**从会话记录正则统计实际调到的工具名**（`toolsAny`/`toolsNone`） | 只统计"有没有出现这个工具名"，不统计发现次数、不看 SDK 字节 |

来源：[DB20a]（canary/expect）、[DB21]（boot_probe）、[DB22]（preset_fidelity 规则）、[DB23]（smoke 工具面统计）、[DB3]。

- **事实：`toolsAny`/`toolsNone` 只在 `smoke` 里生效，不在 `setup` 的金丝雀里生效。** [DB23][DB20a]
- **事实：`preset_fidelity` 支持 `--preset-file`：直接读一个含 `insert: [ { config: { id: <preset>, plugins: [...] } } ]` 的 patch 文件；本仓库 `cordis.patch.yml` 正好是这个形态。** [DB22][P2]
- **事实：`preset_fidelity` 的行切分只认列 0 的 `- id:`，group 只按 preset 侧 `flat()` 展开；它能通过是因为 headless base 恰好把 `plan-mode`/`compaction-basic`/`tool-result-pruner`/`tool-subagent*` 这些**组内行也放在顶层**。**[DB22][DSH16]

### 4.2 判断：现有 expect 覆盖不了本插件的差异

**判断：覆盖不了，而且失败方向很坏。** 本插件的差异有三层，现有判据一层都碰不到：

1. 配置层：插件行是否存在 —— `mustHave` 能覆盖（但只证明"行在"，不证明"插件挂上了"）。
2. 装配层：`system-prompt/assemble` 是否真的替换了 `tools:sdk` —— 只有"段不存在"这一种失败会被插件自己记 telemetry，且**原样返回**（静默）。[P1]
3. 语义层：替换后的 SDK 是否只含 search/describe/eager/Shell —— 无任何判据。

**判断：不改造会把"覆盖层/插件被静默忽略"误判成"渐进披露没有收益"。** 具体误读链：两臂 system prompt 字节相同 → 输入 token 比≈1、费用比≈1、通过率 Δ≈0 → 报告写"换工具面没有区别"，而 ADR 想要的结论是"SDK 变小、成本下降、通过率不降"。这与 dsh-bench 自己踩过的坑同构（`docs/流程-校准.md` 坑 2）。[DB24]

**判断：最小可行改造点（按性价比排序）**

| # | 改动 | 文件 | 作用 | 成本 |
|---|---|---|---|---|
| C1 | 记账代理记录**首个请求体**的 `system` 字节数与 sha256 前 16 位、`tools` 数组长度 | `bench/usage_proxy.py` `_forward()`（读 body JSON 后加 5–8 行，写进 `rec`） | 直接证明"两臂 system 前缀不同、实验臂更短"，并可抓 cache 口径 | 极小 |
| C2 | 加一个机制脚本：从 `_logs/<rid>/session` 数 `tool/ptc-dispatch` 里 `search_tools`/`describe_tools`/`bash`/`write`/`edit` 的次数与步号 | 新文件 `bench/mechanism.py`（读 `_map.jsonl` 关联 rid→臂/题/遍） | 证明插件真的在跑；产出"发现轮次/首次命中/Describe 成功率" | 小 |
| C3 | setup 增加两条 fail-closed 断言：实验臂 `sys_chars` 显著小于对照臂；实验臂 `search_tools` 计数 > 0 而对照臂 = 0 | `bench/bench.py` `cmd_setup` 或复用 `smoke` | 把 C1/C2 变成闸门，而不是事后报告 | 小 |
| C4 | 适配真实 preset 挂载的检查器 | 改写 `ptc_on()` 与 `preset_fidelity` 判定逻辑：`--dump-config` 在真实 preset 挂载时只含 preset 声明行而非展开子行，改为“校验两臂预设文件除 `stable-progressive-tools` 外逐行对齐 + 运行时首请求 `sys_chars`/`sys_sha256`/`tools_sha256` 与 `search_tools` 存在性断言” | 消除真实 preset 挂载下的误报，并真正验证运行时生效 | 小 |
| C5 | 报告里加"暴露子集"过滤（只统计至少发生一次 search/describe 的题） | `bench/analyze.py` | 避免零暴露题把机制指标稀释成 0 | 小 |

**事实（C2 的前提成立）**：PTC 的嵌套调用会作为 `tool/ptc-dispatch` 会话事件写入，字段含 `rootCallId/parentCallId/subCallId/name/arguments/isError/content`；run_bench 已把 session 目录搬到 `runs/_logs/<rid>/session`。[DSH7][DB25]

## 5. token 与成本口径（问题 D）

### 5.1 事实

- **事实：代理逐请求记 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` / `prompt_tokens` / `completion_tokens` / `input_tokens` / `output_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens` / `reasoning_tokens` / `web_search_requests`，并记 `dur_s`、`status`、`model`、`tool_calls`（工具调用块计数）。**[DB7]
- **事实：每行都带 `tag`**（runner 在每次运行前 `POST /__tag`，结束时清空）；只有带 tag 的行进入 arm 汇总，所以"探测请求"不进账。健康闸门与熔断探测是**直接打上游**、不经代理的（`probe_upstream` 用独立 opener），因此也不计费入账。[DB7][DB26][DB27]
- **事实：供应商 503/429 的运行内重试会**重新走同一个代理**，每次重试各自记一行、累加到同一 tag；记录里另有 `retried` 字段可用于剔除。**[DB28]
- **事实：费用 = `hit×cache_hit + miss×cache_miss + out×output`（元/百万 token，取高峰价表），Anthropic 口径的 `cache_creation_input_tokens` 被归入 miss；同时算一个 `cost_nocache`（假设全部未命中）作敏感性。** [DB8][DB29]
- **事实：配对比较时费用只在"两臂都记到账"的题上算；代理漏记会标 `usage_missing` 并剔除，避免把费用比拉向 1。** [DB29][DB30]
- **事实：`analyze` 的 Δ 是"先对每题 reps 取均值，再对题做 10000 次 bootstrap 取 95% CI"；非劣效判据是 `CI 下限 > -margin`；McNemar 用题×遍的 2×2 精确检验。** [DB31]

### 5.2 判断：这笔节省会体现在 cache_hit/miss 里吗？

**判断：会，但主要体现在"每次请求的前缀总长"上，而不是只在一次冷启动上。** 推理（本笔记的机制判断，非实测）：

- 系统提示是每轮请求的**稳定前缀**，所以两臂的差别是**每一轮**的 system 都短一截；DeepSeek 的 `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens` 是按前缀命中拆分，前缀变短 ⇒ hit 与 miss 的**绝对量都下降**，而命中率（hit/(hit+miss)）未必上升。
- 因此"成本下降≥10%"（2026-11-27 调整后门槛）应写成**绝对费用比的单侧 95% 配对 CI 判据**（费用比 95% 分位 ≤0.90，且由 Provider 实际账单导出交叉印证），而不是"命中率上升"。
- 每题一个新会话 ⇒ 首轮必然 miss（写缓存），而首轮 miss 正是 SDK 缩短收益最大的地方；dsh-bench 的"一题一会话"结构实际上**放大了**本插件的收益面，比长会话更有利，这一点必须在报告里写明，不能外推到生产。
- **判断：记账足以支撑"是否下降了 10%"这个测量，但不足以支撑归因**，除非把下列混杂项固定或记录。

**必须固定的混杂项（判断 + 事实支撑）**

| 混杂项 | 为什么 | 现状 |
|---|---|---|
| prompt cache 前缀 | 两臂 system 不同 ⇒ 服务端缓存不可跨臂复用；同臂内先后运行会互相预热 | `stagger_arms` 只是错开同题，不保证冷热一致 [DB28] |
| 错开起点 | 各臂在同一题序上错开 `k` 位，避免同时做同题 | 已实现，但**首遍应剔除**（校准文档要求）[DB28][DB32] |
| 子代理 | 子代理产生额外请求，tag 相同会并入本 run | 未拆；须按 session 过滤 |
| compaction | 压缩会追加/改写历史，token 突然变大 | 本仓库 preset 的阈值是 8192/4096/1024；dsh-bench ptc 臂用出厂值 [P2][DB33] |
| tool-result-pruner | 同上，裁剪改变后续前缀 | 同上 |
| 重试 | 供应商重试的 token 全额计入 | 有 `retried` 字段可剔除 [DB28] |
| 输出 token | 发现轮次会让模型多输出，可能吃掉输入节省 | 只有汇总，没有分轮 |

## 6. 任务分布与区分度（问题 E）

### 6.1 事实

- **事实：160 题 = 104 main + 56 reserve；main 的分层是 编程 38 / 长任务注意力 33 / 日常办公 25 / 知识 8。** 判分器分布（main）：`mcq` 20、`lcb_stdio` 16、`ssb_cells` 15、`self_chain` 12、`polyglot_python` 10、`exact_int` 9、`lcb_functional` 7、`polyglot_javascript` 5、`self_o_*` 9（合计 104，本笔记从 `manifest/manifest.csv` 复算）。[DB34]
- **事实：题面模板不点名任何本地工具。** `prompts/common.md` 只约束"不联网、只在当前目录、不要找现成答案、结果以文件为准"；交付模板点名的是 `solution.py` / `ANSWER.txt` / `output.xlsx` 这些**产物**，不是工具。[DB35]
- **事实：`prompts/common.md` 的命令行里被显式禁止的是 `curl/wget/Invoke-WebRequest/pip install/npm install/git clone`，不是 bash/read/edit。**[DB35]
- **事实：判分是产物级的**（隐藏测试、单元格比对、整数、逐项检查），不检查"用了哪些工具"。[DB36]
- **事实：运维口径里"一遍全跑 2 臂×104 题、2 槽/臂约 1–2.5 小时；5 遍 7–12 小时；单题 1 万–40 万 token，长任务可达 60 万"。**[DB37]

### 6.2 判断：哪些题会真的触发发现

**判断：触发点不在题面，而在本仓库的 eager 集合与 dsh-bench 的产物要求之间的错配。**

- 插件默认 `eagerTools=[read, grep, glob]` + 会话 Shell（Linux 上是 `bash`），其余全部隐藏；`write`/`edit`/`todo`/`present` 都要先发现。[P5][DSH17]
- dsh-bench 的 104 题里，编程（38）要写 `solution.py`，办公（25）要写 `output.xlsx`，知识（8）要写 `ANSWER.txt`，长任务（33）多为"按步骤产出文件"——**几乎全部需要 write/edit**。所以：
  - 绝大多数题会**强制**走一次 `search_tools → describe_tools → write/edit` 的发现链（这对测量是好事：处理被暴露）；
  - 但这也意味着 dsh-bench 测到的是"write/edit 被隐藏的代价"，而不是"生产配置下渐进披露的净收益"。若把 `write`/`edit` 加进 eager，发现链会大幅减少、收益面也随之缩小。
- **判断：知识类 8 题与部分长任务很可能一次 discovery 都不触发**（只读材料 + bash/read 即可，或纯推理）。这些题对"通过率不降"仍是有效配对样本，但**不能计入发现类机制指标**，否则会把"发现轮次"稀释成接近 0。
- **判断：题面不点名工具 ⇒ 对渐进披露是公平的**；反过来，如果题面写了"用 read 打开"，就会既泄露工具存在、又让对照臂白拿分。本套题没有这个问题。[DB35]
- **事实：事后分层是可行的，且不需要改 dsh-bench 核心。** `tool/ptc-dispatch` 事件提供嵌套工具名与 `isError`；`_map.jsonl` 提供 rid→(arm, task, rep)；session 目录已被搬到 `_logs/<rid>/session`。只要写一个只读脚本就能得到"每 run 的 search/describe 次数、首次 write/edit 步号、失败分类"。[DSH7][DB25]

## 7. 统计设计（问题 F）

### 7.1 事实

- **事实：主指标是题级配对 Δ 的 95% CI（每题先对 reps 取均值，再对题重抽样 10000 次），非劣效判据 = CI 下限 > −margin。** [DB31]
- **事实：McNemar 是精确二项检验，输入是题×遍级别的 b/c 不一致对；它与题级 bootstrap 的抽样单位不同。** [DB31]
- **事实：默认 `margin: 5`；ADR 的门槛是 2pp；`sample_size.py` 用正态近似估功效，配置注释与审计自报"margin=5、r=3 时把握只有 0.38，r=5 才 0.57"。** [DB19][DB38][DB39][DB40]
- **事实：`sample_size.py --pre` 用预跑的每题 p 重算（夹在 [0.03,0.97]），但它不做 cluster 修正；而长任务 33 题只有约 6 个独立设计（审计 P1-15）。** [DB38][DB40]
- **事实：报告已内建两条免责/敏感性：多重比较未校正、"仅两臂都正常结束"的 Δ/CI；还给了扣猜测地板后的净正确率。** [DB31]

### 7.2 算术（标明假设，可与 `sample_size.py` 对账）

假设：题级配对差 `d_t` 的总体 SD ≈ 0.6（即二值题 p≈0.75、两臂独立时 `SD=√(2p(1−p))≈0.61`，中档题占多数时与它同量级）；`r` 遍后均值 SD ≈ `0.6/√r`；Δ 的 SE ≈ `0.6/√(n·r)`；非劣效要求 `1.96·SE < margin`。

| n（配对题） | margin | 需要的 n·r | 需要的 r |
|---|---|---|---|
| 104 | 5pp | ≈ 554 | **6** |
| 104 | 3pp | ≈ 1540 | **15** |
| 104 | 2pp | ≈ 3460 | **34** |
| 60（暴露子集） | 5pp | ≈ 554 | **10** |
| 60 | 3pp | ≈ 1540 | **26** |
| 60 | 2pp | ≈ 3460 | **58** |

**判断：ADR 的"通过率回退 ≤2pp"用这套 104 题 + 每臂几遍的设计在统计上不可达。** 要么把门槛改成 3–5pp，要么换更灵敏的设计（同一题内多次重复取多数、或把"每题 r 遍"改成"每题只跑 1 遍但题量翻倍"——后者对本题库不可行，因为题量固定）。这与 dsh-bench 自己的 r=5 结论一致，不是本笔记的新发现。[DB39]

**判断：不一致对的数量级。** 按它 `prior` 的假设分布（35% 高 p、40% 中、25% 低），单遍期望不一致率 ≈ `2·E[p(1−p)] ≈ 0.36`；104 题×3 遍 ≈ 312 对里约 112 个不一致对。McNemar 对这种量级上的 2pp 系统性偏移（约 6–7 对的 b/c 差）不敏感，但**即使显著也不能证明非劣效**——McNemar 的 p>0.05 只说明"没有证据显示有差别"。非劣效只能由 CI 下限回答。因此 ADR 的判据只能用 `Δ 的 CI 下限`，McNemar 只作描述。

### 7.3 事实纠正：dsh-bench 自己的"3 遍/660 次"是过期口径

- **事实：`stages.stage1.rep_from=0, rep_to=5`，`cmd_stage` 跑 `range(rep_from, rep_to)` ⇒ 5 遍；`stage2` 3→6 ⇒ 补到 6 遍。** [DB41][DB42]
- **事实：`config.example.json` 的 `_说明` 仍写"两臂各 3 遍（2×110×3=660 次）"，与 `rep_to: 5`（以及 README 的"5 遍 7–12 小时"）不一致；而 main 实际是 104 题，不是 110。** [DB19][DB37][DB41]
- **判断：** 引用规模时必须写"104 主测 ×2 臂 ×**5** 遍 = 1040 次（6 遍则 1248）"，不要沿用"660"。若要 3 遍，应显式把 `rep_to` 改成 3 并接受功效下降。

## 8. 运行代价与工程约束（问题 G）

### 8.1 事实与算术

- **事实：自报墙钟 = 2 槽/臂下一遍约 1–2.5 小时；5 遍 7–12 小时。**[DB37]
- **算术（假设）：** 660 次（3 遍）按每遍 1.4–2.4 h 估，约 **4–7 小时**；1040 次（5 遍）约 **7–12 小时**。费用按价表（hit 0.04 / miss 2 / out 8 元每百万）与"单题 1–40 万 token、输出约占 10–20%"估算，单次约 **0.1–0.5 元**，3 遍全量约 **70–300 元**，5 遍约 **120–500 元**。**这是量级估计，不是实测；价表按高峰价。** [DB8][DB37]
- **判断：** 钱不是瓶颈，**墙钟与题量**才是。这支持"少题多遍"（固定题集、加 reps）而不是"多题少遍"。
- **事实：env 隔离是软隔离**（随机目录 + 断网环境变量 + 启动前泄漏自检；读权限不受限，`~/.dsh` 与 `bench/` 对 agent 可读）；**docker 才是真隔离**（internal 网络 + 只挂载工作目录/DSH_HOME/state）。[DB43][DB44][DB45]
- **事实：docker 模式下 profile 与插件安装发生在一次性有网容器里，只挂 DSH_HOME；跑题容器不再有外网。**[DB15][DB20]
- **事实：泄漏自检的关键词表包含 `bench`、`preset(s)`、`arm(s)`、`插件`、`评测` 等；启动前扫描 prompt、工作目录路径、工作目录文件内容、环境变量、命令行参数、**公共覆盖层与本次运行层的内容**；臂自己的覆盖层被**显式豁免**（"那是对照臂的处理本身"）。** 项目根目录若命中关键词只提示不失败。[DB46][DB47][DB48]
- **判断：插件 telemetry 写 DSH_HOME 不会被泄漏自检或隔离破坏。** 原因：扫描面不含 DSH_HOME；docker 把 DSH_HOME 挂成可写；telemetry 写失败也被吞掉。**但两臂共享同一个 DSH_HOME**，所以 telemetry 与 surface 恢复记录会跨臂共存；插件只在实验臂，故不会污染对照臂，但"干净房间"假设不成立——报告里要按 session id 过滤，或给实验臂单独 `dsh_home`。[P6][DB16][DB49]
- **判断：Windows/macOS 专属的 `ELECTRON_RUN_AS_NODE=1` 与 `dsh_command` 在本机 Linux 上不是障碍。** `cfg.env` 会被原样注入（多一个环境变量对 DSH 无影响），`dsh_command: null` 时走 `shutil.which("dsh")`，本机在 `~/.npm-global/bin` 里能找到。真正的障碍是 `dsh_version_pin` 与**依赖未装**（本机 python3 没有 PyYAML，`preset_fidelity.py` 与 `setup` 会直接失败）。[DB50][DB51][DB19]

## 9. 需求覆盖缺口与最小实验设计（问题 H + I）

### 9.1 明确判断

**判断：现状 = "不可开箱直用"；小改造后 = "可用（作为真实 preset 对照的通过率 + 成本主实验台）"；机制指标与安全负例 = "必须在本仓库另建补齐"。** 证据强度：

- 「headless 默认不选 preset，但可用 ~20 行 driver 挂真实 preset」：**强**（本机实测 `ptc` 31,415 vs `stable-ptc-eval` 8,960 字符，完整 preset 组合 59,940 vs 10,828 字符，无需改 DSH 本体）。
- 「现有检查器对本插件失明且在真实 preset 挂载下会误报」：**强**（`ptc_on()` 与 `preset_fidelity.py` 只检查顶层 dump 行）。
- 「机制指标与安全负例必须另建」：**强**（判分不看工具、Recall 需生产目录标注集、拒答/权限需负例题族）。
- 「104 题下 2pp 不可达，需两道门策略」：**强**（`sample_size.py` 实测功效）。

### 9.2 最小改造清单（全部收口到本仓库 `eval/`，不拷贝 38 MB 题库）

所有自研配置、驱动与分析脚本统一放入本仓库 `eval/`（Python 依赖用 `uv` 管理），通过 `DSH_BENCH_DIR=/home/lz/dev/dsh-bench-1.1.0` 外部引用题库与判分器：

| # | 资产路径（本仓库 `eval/`） | 作用 | 必要性 |
|---|---|---|---|
| 1 | `eval/dsh-bench/preset-driver.mjs` + `overlays/preset-runtime-{ptc,stable}.yml` | 在 headless 中挂载真实 `ptc` / `stable-ptc-eval` preset（含完整工具目录，两臂统一禁 `tool-web`） | 必须 |
| 2 | `eval/dsh-bench/config.template.json` | 对齐 `dsh_version_pin: "0.2.2-rc.2"`、百炼 `deepseek-v4.1-flash-1017`（Anthropic 主端点 + OpenAI 备选端点）、双臂独立 API Key / 价表、AB/BA 交错顺序 | 必须 |
| 3 | `eval/dsh-bench/usage_proxy_ext.py`（或补丁） | 逐请求记录 `sys_chars` / `sys_sha256` / `tools_sha256` / `tools_len` 与三类 token（用于验证非 Compaction 前缀稳定率 100% 与处理生效） | 必须 |
| 4 | `eval/dsh-bench/preflight.py` | 替代误报的 `ptc_on()` / `preset_fidelity.py`：核对两臂预设文件仅差插件行 + 首请求断言（实验臂 `sys_chars` 显著更短、实验臂有 `search_tools` 而对照臂无） | 必须 |
| 5 | `eval/dsh-bench/mechanism.py` + `stats.py` | 从 `_logs/*/session` 提取 `tool/ptc-dispatch` 计算发现轮次/首次命中/参数合法率；按单侧 95% CI（5% / 95% 分位）输出通过率与每分配任务总成本判据 | 必须 |
| 6 | `eval/recall/`（100 条生产目录标注集） | 复用 `src/search-recall.ts` 验原始词法排序 Recall@5 ≥97%（与 `zeroMatch: catalog` 分开报） | 必须 |
| 7 | `eval/micro/`（15–20 题 DSH 专属微基准） | 验权限/安全一票否决项、SchemaHash 变更、非法参数合法率与正确拒答率 | 必须 |

> 注意：`dsh-bench` 原生 `mustNot` 不能断言“某顶层行不存在”，且真实 preset 挂载时子行不在顶层 dump 里；因此由 `preflight.py` 改用“预设文件结构 diff + 首请求抓包断言”作为 fail-closed 闸门。[DB20a]

### 9.3 最小可行实验设计（与已冻结的 ADR 0001 决策对齐）

**臂定义**

| 臂 | 装配 | 与另一臂的差异 |
|---|---|---|
| `ptc`（对照） | `preset-runtime-ptc.yml` + 出厂 `ptc.patch.yml`（禁 `tool-web`） | — |
| `stable`（实验） | `preset-runtime-stable.yml` + 本仓库 `cordis.patch.yml`（禁 `tool-web`，`eagerTools: [read, grep, glob]` 冻结默认值） | **仅多 `stable-progressive-tools` 一行** |

其余全部固定：DSH `0.2.2-rc.2`、阿里百炼 `deepseek-v4.1-flash-1017`（Anthropic 主端点）、同解码参数、同权限与 `env` 软隔离（报告显式标注）、两臂独立 API Key（便于费用中心明细账单拆分）、每次重复新建会话、AB/BA 交错顺序。

**分阶段规模与统计判定**

| 阶段 | 题 | 遍数 | margin | 主判据（单侧 95% CI） | 目的 |
|---|---|---|---|---|---|
| 预实验 | 12（4 维分层各 3 题）+ 微基准 1 遍 | 1（24 runs） | — | 前缀稳定 100%、首请求 `sys_chars` 缩短、实验臂有 `search_tools` 且对照臂无、代理 vs `bl` vs 账单对账打通 | 验证采集、评分与对账链路（不做显著性结论） |
| 第一阶段（过筛） | 104 主测 | 6–8（待预实验方差冻结） | **5pp** | 通过率差 5% 分位 `> -5pp`；每分配任务总费用比 95% 分位 `≤ 0.90`（且 L3 账单核对 ≥10%）；前缀稳定 100%；Recall@5 ≥97%；安全零回退 | 以可控预算判断是否值得冲正式放量线 |
| 第二阶段（放量复核） | 扩样 / 第二条模型线路 | 按第一阶段方差重算 | **2pp**（或届时重审） | 满足 2pp 非劣效 + 实际成本 ≥10% + 第二线路复核 | 支撑 `stable-ptc-eval` 生产可用结论 |

**停机条件（判断）**

1. 实验臂出现 `surface-conflict/missing-section` 或 telemetry 无 `session-open` → 处理没生效，停。
2. 两臂首请求 `sys_sha256` 相同或 `sys_chars` 差 <5% → 覆盖层没生效，停。
3. 实验臂 `search_tools` 计数 = 0（预实验 12 题 × 2 臂 = 24 次运行内）→ 停。
4. `provider_error` 比例 >20% → 停（沿用它的熔断口径）。[DB27]
5. 主实验中点 Δ 的 CI 下限 < −10pp → 停并回滚。
6. dispatch 里 `isError` 比例 >10% → 停（说明插件的调用路径有问题，不是模型问题）。

**报告写法（判断）**：通过率与费用必须成对出现；费用比要给"含缓存"和"不计缓存"两列；明确写"一题一会话 ⇒ 首轮全长 miss，收益面被放大，未外推到生产"；机制指标只在暴露子集上报告并给出子集定义。

## 10. 风险与待验证清单

1. **已解决（原最高优先）：headless 挂载真实 preset。** 已用 ~20 行 `preset-driver` 实测打通，无需再做 host-plane 等效性假设（见 §1.2）。
2. **待验证（最高优先）：百炼 Anthropic 端点（`.../apps/anthropic`）在 `deepseek-v4.1-flash-1017` 下的真实响应字段与缓存计费行为。** 预实验首笔请求即核对 `cache_read_input_tokens` / `cache_creation_input_tokens`（若异常则一键切到 OpenAI 新格式端点 `.../compatible-mode/v1`），并导出阿里云费用中心明细账单 CSV 验证双 Key/双空间拆分与未抵扣金额列。
3. **待验证：通过 `uv` 管理的独立虚拟环境安装 `PyYAML`/`pytest`/`openpyxl` 并跑通 `dsh-bench` 判分器自检。**
4. **待验证：`tool/ptc-dispatch` 在本插件路径下确实写入 session**（我们不改 PTC，应然成立；一次 smoke 即可确认）。
5. **待验证：SDK 缩短是否跨过 DeepSeek 的 cache 分块边界**，即缩短 2–4 KB 是否真的减少计费 token；需要 C1 的 `sys_chars` 与代理 token 对照。
6. **待验证：docker 模式下插件如何进入容器。** 需要把包复制/打包进 `dsh_home(docker=True)`，或在 registry 发布；宿主绝对路径与 `link:` 会断。本条未实测。
7. **待验证：`arms.stable.expect` 如何断言对照臂**没有**插件行**（现有 `mustNot` 语义不支持"行不存在"，需新判据）。
8. **风险：`stagger_arms` 只避免同题同时跑，不消除服务端缓存冷热差异**；首遍应剔除或单列。
9. **风险：两臂共享 DSH_HOME**，telemetry/surface 记录共存；分析按 session 过滤，必要时给实验臂独立 `dsh_home`。
10. **风险：本题库 35% 是选择题/整数题（猜测地板 ≈4.7pp），与 5pp 非劣界同量级**；分析必须用报告里"扣地板后的净正确率"，并优先看编程/办公/长任务三个维度。
11. **风险：长任务 33 题只有约 6 个独立设计**，题级 bootstrap 会把区间算窄；需要 cluster bootstrap 或按簇报告。
12. **风险：本笔记的墙钟/费用是量级估计**，不是实测；正式预算应按 smoke 的实测单题 token × 题数重算。

## 11. 来源

**dsh-bench（DB）**

- [DB1] `bench/run_bench.py:274-275`（env 模式 `dsh --profile … --patch … --json`）
- [DB2] `bench/isolation.py:99-127`（覆盖层顺序与自动运行层）、`bench/isolation.py:102`（common+arm）
- [DB3] `bench/bench.py:354-366`（`arms.<臂>.preset` 只用于 `preset_fidelity`）
- [DB4] `bench/bench.py:232-263`（canary）、`bench/preset_fidelity.py:163-215`（逐行比对）
- [DB5] `bench/grade.py:582-600`（GRADERS 与 grade 入口）
- [DB6] `manifest/manifest.csv`、`bench/calibrate.py:36-66`（main/reserve 与补位）
- [DB7] `bench/usage_proxy.py:34-46`、`:153-156`（字段与日志行）
- [DB8] `config.example.json:127-134`（价表）、`bench/analyze.py:70-71`（费用公式）
- [DB9] `bench/run_bench.py:346-350`（`wall_s` 入记录）
- [DB10] `bench/usage_proxy.py:153`（`dur_s`）
- [DB11] `bench/run_bench.py:325-327`（session 目录搬入 `_logs/<rid>/session`）
- [DB12] `bench/bench.py:174-182`（`profiles_of`）、`bench/isolation.py:63-66`（DSH_HOME）
- [DB13] `bench/isolation.py:72-88`（profile 名随机化）
- [DB14] `bench/bench.py:316-330`（`dsh plugin --profile <p> add <pl>`）
- [DB15] `bench/isolation.py:236-243`（docker setup 容器内装插件）
- [DB16] `bench/isolation.py:154`（`env["DSH_HOME"] = home`）
- [DB17] `overlays/native-ptc.patch.yml:1-24`（ptc 臂的等价翻译）
- [DB18] `bench/bench.py:345-349`（扫 `patch: entry … not found`）
- [DB19] `config.example.json:7,94-117`（`dsh_version_pin`、stages、margin、3 遍/660 注释）
- [DB20] `bench/isolation.py:261-285`（docker 运行只挂载三项）
- [DB20a] `bench/bench.py:238-263`（expect 的四种判据）
- [DB21] `bench/bench.py:269-288`（boot_probe）
- [DB22] `bench/preset_fidelity.py:39-58,146-160,163-215`（EQUIV/WEB_ONLY/行切分/compare）
- [DB23] `bench/bench.py:717-720,782-801`（`tool_surface`、`toolsAny/toolsNone` 只在 smoke）
- [DB24] `docs/流程-校准.md:12-18`（坑 1/2/3：静默忽略、只对齐规则不够）
- [DB25] `bench/run_bench.py:259-260`（`_map.jsonl`）
- [DB26] `bench/bench.py:393-423`（`probe_upstream` 直连上游）
- [DB27] `bench/bench.py:426-442,445-553`（健康闸门与熔断）
- [DB28] `bench/run_bench.py:290-315`（供应商重试与 `retried`）、`:238-243`（错开起点）
- [DB29] `bench/analyze.py:56-71`（tag 汇总、缓存/未命中/费用/cost_nocache）
- [DB30] `bench/analyze.py:225-231`（`usage_missing` 剔除）
- [DB31] `bench/analyze.py:91-110,240-262,264-270`（bootstrap/McNemar/非劣效/功效）
- [DB32] `docs/流程-校准.md:12`（首遍不算进结论）
- [DB33] `bench/preset_fidelity.py:47-51`（DEFAULT_ALLOW 含 plan-mode 等）
- [DB34] `docs/设计.md:9-20`、`manifest/manifest.csv`（160=104+56；本笔记复算 main 分布）
- [DB35] `prompts/common.md:1-15`、`bench/prompting.py:15-17,72-76`
- [DB36] `docs/设计.md:22-33`（判分器清单）
- [DB37] `README.md:150-157`（规模与耗时）
- [DB38] `bench/sample_size.py:23-33,44-55`
- [DB39] `config.example.json:104`（r=3 把握 0.38、r=5 才 0.57）
- [DB40] `docs/审计-v1.0.0.md:53,87`（R9 功效、P1-15 长任务簇）
- [DB41] `config.example.json:94-115`、`bench/bench.py:1055`（`range(rep_from, rep_to)`）
- [DB42] `bench/bench.py:1052-1077`（stage 规划）
- [DB43] `bench/isolation.py:5-14`（env vs docker 的能力边界）
- [DB44] `README.md:127-137`（env 是软隔离）
- [DB45] `bench/isolation.py:279-285`（docker 网络与挂载）
- [DB46] `bench/leakcheck.py:23-37`（TERMS）
- [DB47] `bench/run_bench.py:190-208`（preflight 扫描面）
- [DB48] `bench/run_bench.py:276-278`（臂覆盖层豁免）
- [DB49] `bench/bench.py:299-332`（setup 的 DSH_HOME 与 profile 初始化）
- [DB50] `config.example.json:137-140`（`ELECTRON_RUN_AS_NODE`）、`bench/isolation.py:157`（`cfg.env` 注入）
- [DB51] `bench/run_bench.py:86-104`（`resolve_dsh` 与 `dsh_command`）

**DSH 0.2.2-rc.2（DSH）**

- [DSH1] `apps/cli/src/args.ts:59-75,186-196`（launcher 只有 profile/patch/dump 系列）
- [DSH2] `packages/bundle/headless/cordis.patch.yml:9-46`、`packages/bundle/headless/package.json:42-44`（无 preset roster）
- [DSH3] `packages/bundle/web-app/cordis.patch.yml:617-620`（`agent-preset-registry` `default: standard`）
- [DSH4] `packages/bundle/web-app/package.json:49-56`（`dsh.bundle.patch` 列出 `presets/*.patch.yml`）
- [DSH5] `packages/bundle/headless/src/index.ts:200-235,367-372`（拒绝带 preset 的会话；不组合 roster）
- [DSH6] `packages/preset/agent-preset/src/index.ts:13-25`（`static inject = ['agentPresets']`）
- [DSH7] `packages/core/tool-executor-ptc/src/ptc.ts:560-573`（`tool/ptc-dispatch` 事件字段）
- [DSH8] `packages/core/tool-executor-native/src/index.ts:1-33`（native 执行器不注册 prompt section）
- [DSH9] `packages/boot/app-boot/src/index.ts:518-620`（patch 列表格式、必填/抛错）
- [DSH10] `packages/boot/app-boot/src/index.ts:566-580`（insert 内相对/绝对名 → `file://`）
- [DSH11] `packages/boot/app-boot/src/index.ts:581-590`（目标行缺失只是 per-entry 警告）
- [DSH12] `packages/boot/app-boot/src/profile.ts:1-15`（profile = bundles 层 + 自身 patch + `--patch`）、`packages/boot/plugin-manager/src/operations.ts:95-125`（bundle 选择与 `dsh.profile.bundles`）
- [DSH13] `packages/core/tool-executor-ptc/src/index.ts:34-37`（`tools:sdk` 段名与 order）
- [DSH14] `packages/boot/app-boot/src/plugin-compatibility.ts:60-90`（engines/peers 兼容性判定，含 prerelease）
- [DSH15] `apps/cli/src/plugin.ts:99-103`（不兼容时提示 `allow-version … --accept-risk`）
- [DSH16] `packages/bundle/base/cordis.patch.yml:336,355,363,374-405,435`（组内行在 base 里是顶层行）
- [DSH17] `/home/lz/dev/dsh-stable-progressive-tools/src/config.ts:31-41`（默认 eager 集合与 shell 解析）

**本仓库（P）**

- [P1] `src/host.ts:333-352`（`system-prompt/assemble` 钩子；`:337-343` 缺段时原样返回并记 telemetry）
- [P2] `cordis.patch.yml:4-8,129-130`（`- insert:` preset 行；插件行）
- [P3] `src/search-recall.ts:14-40`（固定标注集的 macro Recall@5）
- [P4] `package.json:30-43,68-72`（peer 精确钉 rc.2；`dsh.bundle.patch`）
- [P5] `README.md:11-18`、`src/surface.ts:62-102`（初始 SDK 组成与 Surface）
- [P6] `src/telemetry.ts:45-55`（DSH_HOME JSONL、失败吞掉）、`src/surface-store.ts`（原子恢复记录）
