# AGY 插件功能对齐 Claude 的可行性与实施方案

> 文档定位：在 CloudCLI（open-cloude-agent）作为底座、AGY（cloude-agent-agycli）作为独立仓库 agent 插件的架构下，论证"AGY 能否达到与内置 Claude provider 完全等同的契约功能"，并给出两侧（主仓库适配层 + agy 仓库引擎驱动）的落地路线。
>
> 编写日期：2026-11-02

---

## 目录

1. [结论速览](#1-结论速览)
2. [架构与角色边界](#2-架构与角色边界)
3. [现状对比：Claude vs AGY 的契约完成度](#3-现状对比claude-vs-agy-的契约完成度)
4. [能力可达性分析（分三层）](#4-能力可达性分析分三层)
5. [需实测验证的灰区](#5-需实测验证的灰区)
6. [永远无法 1:1 对齐的部分](#6-永远无法-11-对齐的部分)
7. [参照坐标：每个 facet 该抄哪里](#7-参照坐标每个-facet-该抄哪里)
8. [分阶段实施路线](#8-分阶段实施路线)
9. [工作量与风险评估](#9-工作量与风险评估)
10. [附录：关键文件索引](#10-附录关键文件索引)

---

## 1. 结论速览

| 判断 | 结论 |
|---|---|
| 底座（CloudCLI）的 provider 契约与扩展机制是否完整 | **是。** `IProvider` 接口定义完整、provider 无关；`providerRegistry` 支持运行时动态注册/注销；`PluginAgentProvider` 与 `ClaudeProvider` 实现同一接口。 |
| 差距是否在底座机制 | **否。** 差距在两侧实现的完成度，不在机制本身。 |
| 是否"只改 agy 插件即可" | **否。** 必须两边一起动：主仓库的 `PluginAgentProvider` 适配层目前收窄了事件流、把若干 facet 写死成 Noop；agy 仓库也只产出文本。 |
| 参照 ClaudeProvider 即可补齐吗 | **部分。** 更贴切的样板是 **Codex / Cursor / OpenCode**——它们同样是"对接外部 agent CLI"，形态与 agy 一致；Claude 是"对接进程内 SDK"，形态不同。 |
| 整体可行性 | **可行，但工作量等于把 AGY 从 MVP 文本代理重写为完整引擎适配器。** |

**核心命题**：

> 底座的 provider 契约和扩展机制已经完整支持一个 provider 应有的全部能力；当前的差距不在底座机制，而在两侧实现都停在 MVP——宿主侧 `PluginAgentProvider` 适配层收窄了事件流、把若干 facet 写死成 Noop，agy 插件侧也只产出文本。参考内置 provider 的实现来补齐**这两侧**，就能让 AGY 达到与 Claude 同等的契约功能。

---

## 2. 架构与角色边界

### 2.1 仓库划分

```
┌─────────────────────────────────────────────────────────────┐
│  主仓库：open-cloude-agent （底座 / 宿主）                   │
│                                                             │
│  server/modules/providers/                                  │
│    ├─ list/claude/        内置 Claude provider（SDK 直连）   │
│    ├─ list/codex/         内置 Codex provider（SDK 直连）    │
│    ├─ list/cursor/        内置 Cursor provider（CLI spawn）  │
│    ├─ list/opencode/      内置 OpenCode provider            │
│    ├─ provider.registry.ts  统一注册表                       │
│    └─ shared/             McpProvider / SkillsProvider 基类  │
│                                                             │
│  server/modules/plugins/                                    │
│    ├─ plugin-agent.provider.ts   ★ 插件适配层（关键）        │
│    ├─ plugin-process.service.ts  插件子进程生命周期          │
│    ├─ plugin-registry.service.ts 插件安装/校验/扫描          │
│    └─ agent-plugins.service.ts   agent 插件 CRUD + 注册      │
└─────────────────────────────────────────────────────────────┘
                            │
                            │  HTTP loopback (127.0.0.1:随机端口)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  独立仓库：cloude-agent-agycli （agent 插件）                │
│                                                             │
│  src/driver.ts        agy CLI 驱动（spawn + stream 解析）    │
│  src/server.ts        插件 HTTP 服务（/chat /models ...）    │
│  src/session-manager.ts  会话连续性映射                      │
│  manifest.json        type=agent, providerId=agy             │
└─────────────────────────────────────────────────────────────┘
                            │
                            │  spawn
                            ▼
                      本地 agy CLI（Google Antigravity）
```

### 2.2 两类工作必须区分

这是本文档最重要的一个区分——**"只改 agy 插件"不够**，因为收窄事件流的代码在主仓库里。

| 工作类型 | 归属仓库 | 关键文件 | 内容 |
|---|---|---|---|
| **A. 宿主适配层增强** | open-cloude-agent | `server/modules/plugins/plugin-agent.provider.ts` | 让 `PluginAgentProvider` 支持非 Noop 的 mcp/skills/fork；扩展 `PluginAgentRuntime` 解析完整事件（tool_use/thinking/permission）；扩展宿主↔插件 HTTP 协议 |
| **B. 插件引擎驱动增强** | cloude-agent-agycli | `src/driver.ts`、`src/server.ts` | 补全 stream-json 事件解析；`/chat` 升级为结构化 SSE；补 MCP/Skills 转发；auth 探测深化 |

**为什么必须两边动**：`PluginAgentRuntime.run()` 在宿主侧（[plugin-agent.provider.ts:239-249](../../server/modules/plugins/plugin-agent.provider.ts)）只解析 `step_update.text_delta` 和 `result` 两类事件。即使 agy 插件把所有事件都吐出来，宿主侧也会丢弃。这是上一轮分析中表达不够清楚、现予补正的关键点。

---

## 3. 现状对比：Claude vs AGY 的契约完成度

两者实现同一个 `IProvider` 接口（[server/shared/interfaces.ts:63](../../server/shared/interfaces.ts)），要求 8 个 facet。Claude 全部实现且多一个 `fork`；AGY 7 个全实现但其中两个是 Noop、一个缺失。

| facet | Claude | AGY | 差距 |
|---|---|---|---|
| `runtime` | `claudeRuntime`（进程内 SDK `query()`） | `PluginAgentRuntime`（HTTP/CLI spawn） | 事件类型收窄：只透传 `text_delta`，丢弃 tool_use/thinking/permission |
| `models` | `ClaudeProviderModels`（curated + 读会话真实模型） | `PluginAgentModels` | `getCurrentActiveModel` 永远返回 catalog DEFAULT，不读会话状态 |
| `auth` | `ClaudeProviderAuth`（读 `~/.claude/.credentials.json` OAuth + env + settings.json） | `PluginAgentAuth` | 仅探测 `--version`，不读登录账号/email |
| `sessions` | `ClaudeSessionsProvider`（读 `~/.claude/projects/<slug>/<id>.jsonl`） | `PluginAgentSessions` | 基本可用，已支持 Antigravity transcript 格式 |
| `sessionSynchronizer` | `ClaudeSessionSynchronizer` | `PluginAgentSessionSynchronizer` | 基本可用，已深度扫描 watchPaths |
| `mcp` | `ClaudeMcpProvider`（真实读写 `~/.claude.json`） | **`NoopMcpProvider`** | list 返回空，upsert 抛 `MCP_NOT_SUPPORTED` |
| `skills` | `ClaudeSkillsProvider`（真实） | **`NoopSkillsProvider`** | list 返回空，add 抛 `SKILLS_NOT_SUPPORTED` |
| `fork` | `ClaudeForkProvider`（支持会话分叉） | **缺失** | "fork session" 对 AGY 不可用 |

**额外运行时能力差距**（`IProviderRuntime` 的可选方法）：

| 能力 | Claude | AGY |
|---|---|---|
| `permissions` 权限审批网关 | 有 | 无（强制 `--dangerously-skip-permissions`） |
| `listBackgroundWork` / `stopBackgroundTask` 后台任务 | 有 | 无 |
| token / 上下文窗口用量统计 | 有 | 无 |
| 图片附件处理 | 有 | 无 |
| 通知（notifyRunFailed/notifyRunStopped） | 有 | 无 |

---

## 4. 能力可达性分析（分三层）

### 4.1 第一层 — 宿主接口契约（IProvider facets）：完全可行

`agy --help` 已证实引擎本身具备完整能力面：

```
--output-format stream-json     -- 与 Claude 同构的流式协议
--effort low|medium|high|xhigh|max   -- 推理强度
--mode accept-edits|auto|plan   -- 执行模式
--dangerously-skip-permissions  -- 权限模型存在（去掉即会走提示）
--conversation <id>             -- 会话恢复
--sandbox                       -- 沙箱
mcp add/remove/list/enable/disable   -- MCP 子命令
agent / agents                  -- agent 管理
models                          -- 模型列表
plugin / plugins                -- 插件管理
```

这不是阉割版 CLI，是功能完整的 agent 引擎。当前 AGY 插件功能少，**是插件实现取了能力的一个小子集**，不是引擎限制。

| 当前 Noop/缺失 | agy 引擎对等物 | 可行性 |
|---|---|---|
| `NoopMcpProvider` | `agy mcp add/remove/list/enable/disable` | ✅ 直接接 |
| `NoopSkillsProvider` | agy 的 plugin/skills 体系 + `~/.claude-code-ui/plugins/cloude-agent-agycli/skills/` 已存在 `agy.md` | ✅ 可映射 |
| 缺失的 `fork` | `--conversation <id>` 恢复 + transcript 按行截断重放 | ✅ 可实现 |
| `getCurrentActiveModel` 不读会话 | `agy models` + `--effort` | ✅ 可补 |
| `PluginAgentAuth` 只探测版本 | `agy auth` 凭据文件 | ✅ 可读 |

### 4.2 第二层 — 运行时事件协议：可行，需字段级对齐

**关键证据**：[plugin-agent.provider.ts:720](../../server/modules/plugins/plugin-agent.provider.ts) 的 `normalizeMessage` 已经能解析 transcript 里的：

- `PLANNER_RESPONSE` + `tool_calls`（工具调用）
- `GENERIC` + `source: MODEL`（工具结果）
- `thinking` 字段（思考）

说明 **agy 的 transcript 里本来就有工具调用和思考**，只是 `driver.ts` 的 stdout 流式解析（[driver.ts:237](../../../../../.claude-code-ui/plugins/cloude-agent-agycli/src/driver.ts)）只处理 `step_update.text_delta` 和 `result` 两类，没把它们转出来。补齐事件解析即可透传 `tool_use`/`tool_result`/`thinking`。

权限网关：去掉 `--dangerously-skip-permissions`，agy 会走权限提示；stream-json 应会暴露 permission 请求事件（CLI 设计与 Claude 同构，**大概率有，事件名需实测确认**）。

### 4.3 第三层 — 宿主-插件 HTTP 协议：需升级

当前插件 HTTP（`src/server.ts`）只暴露：

- `/chat`（POST，返回**纯文本** JSON）
- `/execute`（POST，SSE，但只吐 `{text}` 帧 + `[DONE]`）
- `/status`、`/models`、`/sessions`、`/sessions/:id`、`/test`

要透传完整事件流，得把 `/chat`（或新增 `/run`）升级成**结构化 SSE**——每种事件一个 data 帧（`text_delta` / `tool_use` / `tool_result` / `thinking` / `permission_request` / `usage` / `done`）。宿主端 `PluginAgentRuntime.run()` 从"只转发 text_delta"升级成"解析完整事件 → 映射 `NormalizedMessage`"。

这是协议扩展，不是架构阻碍——`PluginAgentProvider` 已经能拿到 manifest + 子进程端口，扩展的是数据格式。

---

## 5. 需实测验证的灰区

以下三项**理论上可行但事件 schema 未知**，必须先跑通 agy 的 stream-json 实测再定方案：

1. **权限审批的具体 stream-json 事件名与字段** —— 去掉 `--dangerously-skip-permissions` 后，agy 是否在 stdout 暴露 `permission_request` 类事件？字段结构如何？这决定权限网关能否实现。
2. **`result` 事件是否带 token usage** —— 决定 token/上下文统计能否做。Claude 的 `extractCodexTokenBudget`（[codex-runtime.provider.ts:42](../../server/modules/providers/list/codex/codex-runtime.provider.ts)）是个可参照的解析样板。
3. **后台任务语义** —— Claude 的 `listBackgroundWork`/`stopBackgroundTask` 在 agy 里是否有对等物？`--remote-control` / `agent` 子命令可能提供，但语义需确认。

**建议的第一步动作**：在终端跑 `agy -p "列出当前目录文件" --output-format stream-json --model gemini-3.8-flash-low`，把完整 stdout 落盘，逐一登记事件类型与字段，形成《AGY stream-json 事件 schema 清单》。这份清单是后续所有工作的输入。

---

## 6. 永远无法 1:1 对齐的部分

底层模型不同（Gemini / Sonnet-4-6 / gpt-oss vs Claude），以下没有 1:1 对等物：

- **Claude 专属的默认 system prompt 约定与 tool 生态默认值**
- **subscription 模式**（Claude 的 `subscriptionOverride`：检测 API key 静默覆盖订阅登录）
- **特定 tool 的语义差异**（即便协议层对齐，工具行为细节随引擎而异）

能做到的是**契约与形态一致**（同样的 facet、同样的事件类型、同样的权限模型、同样的会话/历史/sync 行为），不是"同一个东西"。这个边界必须接受，否则会陷入无限趋近的伪需求。

---

## 7. 参照坐标：每个 facet 该抄哪里

> 原则：**形态优先**。agy 是"对接外部 CLI 子进程"，所以优先抄形态相同的 provider，而不是形态不同的 Claude。
>
> - Claude = 进程内 SDK（`query()`）—— 形态不同，仅作"功能样板"
> - Codex = 进程内 SDK（`@openai/codex-sdk`）—— 形态不同，但事件解析/token 统计可参考
> - **Cursor = `cross-spawn` 直接 spawn CLI** —— 形态最接近 agy，首选参照
> - OpenCode = 独立 turn server 子进程 —— 参照其子进程生命周期管理

| facet / 能力 | 首选参照 | 文件路径 | 参照要点 |
|---|---|---|---|
| runtime：CLI spawn 模式 | **Cursor** | [cursor-runtime.provider.js](../../server/modules/providers/list/cursor/cursor-runtime.provider.js) | `crossSpawn` 子进程、stdout 行解析、权限提示处理（`WORKSPACE_TRUST_PATTERNS`）、`completeSent` 单次终止契约 |
| runtime：stream-json 事件映射 | **Codex** | [codex-runtime.provider.ts](../../server/modules/providers/list/codex/codex-runtime.provider.ts) | `transformCodexEvent` 把 SDK 事件映射为统一格式；`PROGRESSIVE_CODEX_ITEM_TYPES` 决定哪些 item 实时透传 |
| runtime：token 用量解析 | **Codex** | [codex-runtime.provider.ts:42](../../server/modules/providers/list/codex/codex-runtime.provider.ts) | `extractCodexTokenBudget` —— 直接抄解析结构 |
| runtime：权限审批网关 | **Claude** | [claude-runtime.provider.ts](../../server/modules/providers/list/claude/claude-runtime.provider.ts) | `ToolApprovalDecision` / `ToolApprovalResolver`、pending approval 查询、决策注入 |
| runtime：SDK 直连（仅作对照） | Claude | [claude-runtime.provider.ts](../../server/modules/providers/list/claude/claude-runtime.provider.ts) | 66KB 单文件，事件类型最全，作"目标事件集"参照 |
| MCP | **Codex** | [codex-mcp.provider.ts](../../server/modules/providers/list/codex/codex-mcp.provider.ts) + [shared/mcp/mcp.provider.ts](../../server/modules/providers/shared/mcp/mcp.provider.ts) | 继承 `McpProvider` 基类，实现 `readScopedServers`/`writeScopedServers`/`buildServerConfig`/`normalizeServerConfig` 四个抽象方法；agy 对应 `agy mcp` 子命令的配置文件读写 |
| Skills | **Codex** | [codex-skills.provider.ts](../../server/modules/providers/list/codex/codex-skills.provider.ts) + [shared/skills/skills.provider.ts](../../server/modules/providers/shared/skills/skills.provider.ts) | 继承 `SkillsProvider` 基类，实现 `getSkillSources`；agy 的 skills 目录已存在 |
| Fork | **Codex** | [codex-fork.provider.ts](../../server/modules/providers/list/codex/codex-fork.provider.ts) | `forkSession` 调用 `codexAppServer.forkThread`；agy 对应 `--conversation <id>` + transcript 截断 |
| auth：读凭据文件 | **Claude** | [claude-auth.provider.ts](../../server/modules/providers/list/claude/claude-auth.provider.ts) | 读 OAuth credentials.json、env 优先级、`subscriptionOverride` 检测；agy 对应 `agy auth` 的凭据文件 |
| auth：CLI 探测 | **Codex** | [codex-auth.provider.ts](../../server/modules/providers/list/codex/codex-auth.provider.ts) | `probeCliVersion` 模式 |
| sessions：transcript 解析 | 自身已有 | [plugin-agent.provider.ts:678](../../server/modules/plugins/plugin-agent.provider.ts) | `PluginAgentSessions.normalizeMessage` 已支持 Antigravity 格式，基础已具备 |
| 子进程生命周期 | OpenCode | [opencode-runtime.provider.ts](../../server/modules/providers/list/opencode/opencode-runtime.provider.ts) | turn server 启停、孤儿进程清理（`reapOrphanedOpenCodeServers`） |

**最值得深读的三个文件**（按优先级）：

1. [cursor-runtime.provider.js](../../server/modules/providers/list/cursor/cursor-runtime.provider.js) —— spawn CLI 子进程的完整范式，含权限提示、重试、单次 complete 契约
2. [codex-runtime.provider.ts](../../server/modules/providers/list/codex/codex-runtime.provider.ts) —— stream-json 事件映射 + token 用量解析的最直接样板
3. [shared/mcp/mcp.provider.ts](../../server/modules/providers/shared/mcp/mcp.provider.ts) + [shared/skills/skills.provider.ts](../../server/modules/providers/shared/skills/skills.provider.ts) —— MCP/Skills 的基类契约，补 Noop 只需继承并实现少量抽象方法

---

## 8. 分阶段实施路线

按价值/依赖排序，每阶段独立交付，不需要等到全做完才能用。

### 阶段 0：事件 schema 实测（前置，半天）

- 跑 `agy -p <prompt> --output-format stream-json` 落盘完整 stdout
- 登记《AGY stream-json 事件 schema 清单》：每个事件 type、字段、出现时机
- 重点确认灰区三项（权限事件、token usage、后台任务语义）

### 阶段 1：tool_use / tool_result / thinking 透传（体验差距最大）

**侧 B（agy 仓库）**：
- `driver.ts`：扩展 `executeChat` 的事件解析，产出 `tool_use`/`tool_result`/`thinking` 类型 chunk
- `server.ts`：`/chat` 或新增 `/run` 端点改为结构化 SSE，每种事件一个 data 帧
- `types.ts`：`UnifiedChunk.type` 扩展 `'tool_use' | 'tool_result' | 'thinking' | 'permission' | 'usage'`

**侧 A（主仓库）**：
- `plugin-agent.provider.ts` 的 `PluginAgentRuntime.run()`：从"只转发 text_delta"升级为"解析完整事件 → 映射 `NormalizedMessage` → 通过 writer 发出"

### 阶段 2：权限审批网关（安全价值最高）

- 侧 B：`driver.ts` 去掉 `--dangerously-skip-permissions`，解析 permission 请求事件并经 SSE 上报
- 侧 A：`PluginAgentRuntime` 实现 `permissions: ProviderRuntimePermissionGateway`，把 permission 请求转成宿主的审批 UI 流程

### 阶段 3：MCP + Skills（接 agy 子命令）

**侧 A**：
- `plugin-agent.provider.ts`：把 `NoopMcpProvider`/`NoopSkillsProvider` 替换为继承 `McpProvider`/`SkillsProvider` 的真实实现（或在插件侧实现、经 RPC 暴露）
- 决策点：MCP 配置读写放在宿主侧（直接读写 agy 配置文件）还是插件侧（经 RPC 调 `agy mcp` 子命令）。推荐插件侧，保持宿主 provider-agnostic

**侧 B**：
- `server.ts`：新增 `/mcp`（GET/POST/DELETE）、`/skills`（GET/POST/DELETE）端点，转发到 `agy mcp` / agy skills 目录

### 阶段 4：token 统计 + Fork + 后台任务（锦上添花）

- token：抄 `extractCodexTokenBudget` 解析 agy 的 usage 事件
- fork：参照 `CodexForkProvider`，用 `--conversation <id>` + transcript 截断实现
- 后台任务：依赖阶段 0 确认的 agy 后台任务语义

### 阶段 5：auth 深化 + models 读会话

- auth：读 `agy auth` 凭据文件，上报 email/method
- models：`getCurrentActiveModel` 读会话真实模型

---

## 9. 工作量与风险评估

### 9.1 工作量量级

参照 ClaudeProvider：9 个文件、runtime 单文件 66KB。AGY 要做到同等功能，**体量相当**——这不是改几行的事，是把 AGY 从"MVP 文本代理"重写成"完整引擎适配器"。

粗估（含两侧）：

| 阶段 | 侧 | 估算 |
|---|---|---|
| 阶段 0 实测 | — | 0.5 天 |
| 阶段 1 事件透传 | A+B | 3-5 天 |
| 阶段 2 权限网关 | A+B | 2-3 天 |
| 阶段 3 MCP+Skills | A+B | 3-4 天 |
| 阶段 4 token/fork/后台 | A+B | 3-5 天 |
| 阶段 5 auth/models | A+B | 1-2 天 |
| 测试 + 联调 | — | 3-5 天 |
| **合计** | | **约 2-3 周** |

### 9.2 风险点

1. **协议升级的向后兼容**：`/chat` 从纯文本改 SSE 会破坏旧宿主 ↔ 新插件 / 新宿主 ↔ 旧插件的组合。需做版本协商（manifest 加 `protocolVersion`，或保留 `/chat` 旧端点、新增 `/run`）。
2. **跨仓库联调成本**：两个仓库、两个发布周期。建议主仓库适配层做防御式解析——事件 schema 不认识时降级为 text，保证新插件接入旧宿主不崩。
3. **agy 事件 schema 不稳定**：agy 仍演进中，事件格式可能随版本变。driver 解析要做容错。
4. **权限网关的语义对齐**：agy 的权限提示语义未必与 Claude 一致，UI 层可能需要 provider-aware 的提示文案。

### 9.3 不要做的事

- **不要追求"完全一样"**：接受第 6 节的边界，止于"契约一致"。
- **不要一次性大改**：按阶段交付，每阶段可独立验证。
- **不要只改插件侧**：宿主适配层（`plugin-agent.provider.ts`）是必改项，绕不过去。

---

## 10. 附录：关键文件索引

### 主仓库（open-cloude-agent）

| 文件 | 作用 |
|---|---|
| [server/shared/interfaces.ts](../../server/shared/interfaces.ts) | `IProvider` / `IProviderRuntime` 等接口定义 |
| [server/modules/providers/provider.registry.ts](../../server/modules/providers/provider.registry.ts) | 统一注册表（内置 + 动态） |
| [server/modules/providers/shared/base/abstract.provider.ts](../../server/modules/providers/shared/base/abstract.provider.ts) | `AbstractProvider` 基类 |
| [server/modules/providers/shared/mcp/mcp.provider.ts](../../server/modules/providers/shared/mcp/mcp.provider.ts) | `McpProvider` 基类（补 Noop 用） |
| [server/modules/providers/shared/skills/skills.provider.ts](../../server/modules/providers/shared/skills/skills.provider.ts) | `SkillsProvider` 基类（补 Noop 用） |
| [server/modules/providers/list/claude/claude.provider.ts](../../server/modules/providers/list/claude/claude.provider.ts) | Claude provider 组合根 |
| [server/modules/providers/list/claude/claude-runtime.provider.ts](../../server/modules/providers/list/claude/claude-runtime.provider.ts) | Claude runtime（66KB，事件最全） |
| [server/modules/providers/list/codex/codex-runtime.provider.ts](../../server/modules/providers/list/codex/codex-runtime.provider.ts) | Codex runtime（stream-json + token 解析样板） |
| [server/modules/providers/list/codex/codex-mcp.provider.ts](../../server/modules/providers/list/codex/codex-mcp.provider.ts) | Codex MCP（继承基类样板） |
| [server/modules/providers/list/codex/codex-skills.provider.ts](../../server/modules/providers/list/codex/codex-skills.provider.ts) | Codex Skills（继承基类样板） |
| [server/modules/providers/list/codex/codex-fork.provider.ts](../../server/modules/providers/list/codex/codex-fork.provider.ts) | Codex Fork（会话分叉样板） |
| [server/modules/providers/list/cursor/cursor-runtime.provider.js](../../server/modules/providers/list/cursor/cursor-runtime.provider.js) | Cursor runtime（**CLI spawn 首选参照**） |
| **[server/modules/plugins/plugin-agent.provider.ts](../../server/modules/plugins/plugin-agent.provider.ts)** | **★ 插件适配层（必改）** |
| [server/modules/plugins/plugin-process.service.ts](../../server/modules/plugins/plugin-process.service.ts) | 插件子进程生命周期 |
| [server/modules/plugins/agent-plugins.service.ts](../../server/modules/plugins/agent-plugins.service.ts) | agent 插件 CRUD + 注册 |

### AGY 插件仓库（cloude-agent-agycli，位于 `~/.claude-code-ui/plugins/cloude-agent-agycli/`）

| 文件 | 作用 |
|---|---|
| `manifest.json` | `type=agent, providerId=agy, server=dist/server.js` |
| `src/driver.ts` | agy CLI 驱动（**事件解析必改**） |
| `src/server.ts` | 插件 HTTP 服务（**协议升级必改**） |
| `src/session-manager.ts` | 会话连续性映射（`~/.claude-code-ui/agy-sessions.json`） |
| `src/types.ts` | `UnifiedChunk` 等类型（**扩展事件类型必改**） |
| `skills/agy.md` | 已存在的 skill 文件 |
