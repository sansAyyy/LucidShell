# LucidShell 架构设计

## 1. 产品目标

LucidShell 是一个基于 Rust、Tauri、Vue 3 和 TypeScript 构建的桌面 SSH
客户端。

它的核心体验是：清晰的多 Tab 终端工作流，每个 Terminal Tab 都拥有一个对应的
SFTP 工作区，而 CPU、内存、磁盘等监控信息属于服务器级别，在同一台服务器下共享。

产品气质应该是：

- 美观、克制、专业。
- 适合日常高频 SSH 操作。
- 在长时间终端会话和大文件传输中保持稳定、流畅。
- 心智模型清楚：服务器、Terminal Tab、SFTP 面板、监控面板。

## 2. 核心产品模型

### 2.1 Server Session

Server Session 表示一个已连接的远程服务器会话。

它拥有：

- 服务器配置和连接状态。
- 多个 Terminal Tab。
- 一个服务器级 Monitor。
- 面向 terminal、SFTP、monitor 的 SSH 连接池。

### 2.2 Terminal Tab

Terminal Tab 是用户的主要工作上下文。

每个 Terminal Tab 拥有：

- 一个交互式 shell。
- 一个对应的 SFTP 面板。
- 自己的当前工作上下文。
- 自己的 SFTP 展开/折叠状态。
- 自己的 Terminal/SFTP 分栏比例。

### 2.3 SFTP 面板

SFTP 面板属于 Terminal Tab，而不是直接属于服务器。

这样每个 Tab 都可以保留独立的文件工作流，例如：

- `shell-1` 工作在 `/var/www/app`。
- `logs` 工作在 `/var/log`。
- `deploy` 工作在 `/opt/release`。

### 2.4 Server Monitor

Monitor 属于 Server Session。

CPU、内存、磁盘、负载、运行时间、网络等指标都是服务器级数据，所以一台服务器只需要
一个监控视图。

## 3. 技术栈

### 3.1 桌面外壳

- Tauri
- Rust 后端
- 原生系统窗口能力
- 自绘顶部窗口栏

### 3.2 前端

- Vue 3
- TypeScript
- Pinia 或同类状态管理方案
- xterm.js 负责终端渲染
- Feature-Sliced Design 负责前端架构分层

### 3.3 后端

- Rust
- async runtime
- SSH/SFTP transport 抽象
- 基于 actor/task 的会话管理
- 通过 Tauri commands 和 events 与前端通信

## 4. 前端架构

前端采用 Feature-Sliced Design。

推荐目录结构：

```text
src/
  app/
    providers/
    router/
    styles/
    main.ts

  pages/
    server-workspace/
      ui/ServerWorkspacePage.vue

  widgets/
    app-title-bar/
    connection-sidebar/
    terminal-workspace/
    sftp-pane/
    server-monitor/
    status-bar/
    transfer-queue/

  features/
    connect-server/
    disconnect-server/
    import-connections/
    export-connections/
    create-connection-group/
    create-terminal-tab/
    close-terminal-tab/
    rename-terminal-tab/
    toggle-sidebar/
    toggle-sftp-pane/
    resize-terminal-sftp-split/
    upload-file/
    download-file/
    delete-remote-file/
    refresh-remote-dir/

  entities/
    server/
    terminal/
    sftp/
    monitor/
    transfer/
    layout/

  shared/
    api/
      tauri/
    config/
    lib/
    types/
    ui/
```

各层职责：

- `app`：应用初始化、全局 providers、全局样式、Tauri 启动配置。
- `pages`：页面级组合。
- `widgets`：由 entities 和 features 组合出来的大块 UI 区域。
- `features`：用户可以执行的动作。
- `entities`：业务实体模型和状态。
- `shared`：可复用 UI、API client、类型、工具函数、配置。

前端组件不要在各处直接调用 Tauri `invoke`。
所有 Tauri 访问都应该收口到 `shared/api/tauri`。

示例：

```ts
// shared/api/tauri/server.ts
export function connectServer(payload: ConnectServerPayload) {
  return invoke<ServerSessionDto>('connect_server', { payload })
}
```

## 5. 后端架构

Rust 后端应该是一个长期运行的应用核心，而不是一组松散的 Tauri command handler。

推荐目录结构：

```text
src-tauri/src/
  main.rs

  app/
    commands.rs
    events.rs
    state.rs

  domain/
    server.rs
    terminal.rs
    sftp.rs
    transfer.rs
    monitor.rs

  services/
    session_manager.rs
    terminal_service.rs
    sftp_service.rs
    transfer_service.rs
    monitor_service.rs

  transport/
    ssh_client.rs
    ssh_pool.rs
    terminal_channel.rs
    sftp_client.rs

  infrastructure/
    storage.rs
    keyring.rs
    known_hosts.rs
    crypto.rs
    logging.rs

  dto/
    commands.rs
    events.rs
```

### 5.1 分层职责

- `app`：Tauri 集成、全局应用状态、command 注册、event 发送封装。
- `domain`：稳定的业务模型，不依赖 Tauri 或具体 SSH 库。
- `services`：应用工作流和用例编排。
- `transport`：SSH 和 SFTP 库的封装层。
- `infrastructure`：本地存储、系统 keychain、known hosts、日志、加密工具。
- `dto`：前后端 command payload 和 event payload。

### 5.2 Session Manager

`SessionManager` 是后端的编排中心。

它应该管理：

- 活跃的 Server Session。
- Terminal Tab handle。
- SFTP handle。
- Monitor task handle。
- Transfer task handle。
- SSH 连接池。

概念 API：

```rust
struct SessionManager {
    // server_sessions: HashMap<ServerSessionId, ServerSessionHandle>
}

impl SessionManager {
    async fn connect_server(...);
    async fn disconnect_server(...);
    async fn open_terminal_tab(...);
    async fn close_terminal_tab(...);
    async fn write_terminal(...);
    async fn list_remote_dir(...);
    async fn upload_file(...);
    async fn download_file(...);
    async fn cancel_transfer(...);
}
```

## 6. SSH 连接策略

LucidShell 应该共享服务器级连接池，但不要把所有工作负载强行压到同一个物理 SSH
连接上。

推荐模型：

```text
ServerConnectionPool
  terminal pool
    terminal connection 1
    terminal connection 2

  sftp pool
    sftp connection 1
    sftp connection 2

  monitor connection
    lightweight exec/metrics connection
```

MVP 阶段建议：

- 每个 Terminal Tab 默认使用一条独立 SSH 连接。
- 每台服务器维护 1 到 2 条可复用 SFTP 连接。
- 每台服务器维护一条轻量 monitor 连接。

原因：

- 大文件传输时，terminal 交互仍然保持响应。
- SFTP 吞吐不会阻塞 shell 输入输出。
- 监控采集不会和交互式会话抢资源。
- 更容易处理服务器侧 SSH channel/session 限制。
- 某个传输连接断开时，不一定影响所有 terminal。

## 7. 后端并发模型

长期运行的资源应该由 actor 或独立 async task 管理。

推荐的 actor/task：

- `ServerSession`：管理服务器级状态和子任务 handle。
- `TerminalTask`：管理一个 shell channel，并持续推送 terminal output。
- `SftpTask`：管理某个 SFTP 面板或连接池中的文件浏览和文件操作。
- `TransferTask`：管理一次上传或下载任务。
- `MonitorTask`：定时采集服务器指标。

Command 应该向这些 task 发送消息，而不是在多个地方直接抢同一个 SSH 资源的锁。

## 8. 前后端通信

### 8.1 Commands

Tauri commands 用于请求-响应型操作：

- `connect_server`
- `disconnect_server`
- `open_terminal_tab`
- `close_terminal_tab`
- `terminal_write`
- `list_remote_dir`
- `upload_file`
- `download_file`
- `delete_remote_file`
- `rename_remote_file`
- `cancel_transfer`

### 8.2 Events

Tauri events 用于流式或异步状态推送：

- `connection_status_changed`
- `terminal_output`
- `terminal_closed`
- `sftp_dir_changed`
- `transfer_progress`
- `transfer_completed`
- `transfer_failed`
- `monitor_snapshot`

## 9. UI 布局

界面由一行自绘顶部窗口栏、可折叠左侧连接栏、主 Terminal 工作区、每个 Tab
对应的可折叠 SFTP 面板，以及底部状态栏组成。

### 9.1 默认布局

```text
+--------------------------------------------------------------+
| LucidShell                                      Theme Settings|
+----------------+---------------------------------------------+
| Connections    | Terminal Tabs: shell-1 deploy logs +         |
|      ↓ ↑ + ↻ <<|                                             |
| Search...  + ≡ +---------------------------------------------+
|                +---------------------------------------------+
| Favorites      | Terminal                                    |
| prod-01        |                                             |
| staging        |                                             |
|                +---------------------------------------------+
| Recent         | SFTP: /var/www/app                           |
| dev-box        | File table                                   |
| local-vm       |                                             |
+----------------+---------------------------------------------+
| prod-01 · root@10.0.0.12 · 32ms · CPU 18% · MEM 42% · SFTP ok |
+--------------------------------------------------------------+
```

### 9.2 顶部窗口栏

顶部窗口栏使用自绘设计，并且只保留一行。

左侧：

- Logo
- 应用名：`LucidShell`

右侧：

- 主题切换按钮
- 设置按钮
- 最小化按钮
- 最大化/还原按钮
- 关闭按钮

顶部窗口栏不放搜索、服务器监控摘要或复杂工作流按钮。

### 9.3 左侧连接栏

左侧连接栏包含：

- 顶部连接管理按钮。
- 搜索输入框。
- 收藏连接。
- 分组。
- 最近连接。
- 当前连接状态指示。

顶部连接管理按钮建议包含：

- 导入连接。
- 导出连接。
- 新增分组。
- 刷新连接列表。
- 折叠左侧连接栏。

这些按钮应该使用紧凑图标按钮，并提供 tooltip，不使用文字按钮。
展开状态下，连接栏标题行左侧显示标题，例如 `连接`，右侧显示一组图标按钮。
搜索框位于标题行下方。

推荐形式：

```text
连接                            ↓  ↑  +  ↻  <<
+-------------------------------------------+
| 搜索...                              +  ≡ |
+-------------------------------------------+
```

其中：

- `↓`：导入连接。
- `↑`：导出连接。
- `+`：新增分组或新增连接，具体动作可通过 tooltip 或菜单区分。
- `↻`：刷新连接列表。
- `<<`：折叠左侧连接栏。

搜索行右侧可以保留快捷图标，例如新增连接和筛选/排序。

左侧连接栏必须支持折叠。

展开宽度：

- `240px` 到 `280px`

折叠宽度：

- `48px` 到 `56px`

展开模式显示文本标签和连接详情。
折叠模式显示紧凑导航图标和状态指示。

折叠状态需要持久化到本地。

### 9.4 Terminal 工作区

主区域包含：

- Terminal Tab 栏。
- 当前激活 terminal。
- 当前 Tab 对应的 SFTP 面板。

每个 Terminal Tab 都是完整工作上下文。切换 Tab 时，应该恢复该 Tab 的
terminal、SFTP 路径、选中文件、传输状态、折叠状态和分栏比例。

### 9.5 Terminal 与 SFTP 分栏

Terminal 和 SFTP 使用上下分栏，Terminal 在上，SFTP 在下。

默认比例：

- Terminal：`62%`
- SFTP：`38%`

分栏高度支持拖拽调整。

推荐最小高度：

- Terminal：`240px`
- SFTP：`180px`

SFTP 支持按 Terminal Tab 独立折叠。

折叠后保留一个紧凑的 SFTP 状态条：

```text
SFTP  /var/www/app  ·  2 selected  ·  transfer 42%
```

状态条显示：

- 当前远端路径。
- 已选文件数量。
- 传输状态。
- 展开按钮。

### 9.6 底部状态栏

底部状态栏展示当前服务器上下文：

- 服务器名称。
- 用户和主机。
- 连接状态。
- 延迟。
- CPU 使用率。
- 内存使用率。
- SFTP 状态。
- 传输摘要。
- 必要时显示 shell/encoding 信息。

示例：

```text
prod-01 · root@10.0.0.12 · connected · 32ms · CPU 18% · MEM 42% · transfers 2
```

## 10. 状态模型

推荐前端状态类型：

```ts
type ServerSession = {
  id: string
  profileId: string
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  terminalTabs: TerminalTab[]
  activeTerminalTabId?: string
  monitor: MonitorState
}

type TerminalTab = {
  id: string
  serverSessionId: string
  title: string
  cwd?: string
  terminalChannelId: string
  sftpPane: SftpPaneState
  layout: TerminalTabLayoutState
}

type SftpPaneState = {
  currentPath: string
  selectedPaths: string[]
  entries: RemoteFileEntry[]
  transferQueue: TransferTask[]
  status: 'idle' | 'loading' | 'error'
}

type LayoutState = {
  sidebarCollapsed: boolean
  sidebarWidth: number
}

type TerminalTabLayoutState = {
  sftpCollapsed: boolean
  sftpHeightRatio: number
}
```

## 11. 安全要求

安全性应该被当作产品能力来设计。

MVP 阶段可以允许保存明文密码，以降低初始开发复杂度，但必须明确这是临时方案。

MVP 阶段要求：

- 允许用户选择保存明文密码。
- 保存明文密码时需要在 UI 中明确提示风险。
- 默认不保存私钥口令。
- 配置文件中需要为后续凭据迁移预留字段，例如 `credentialStorage: "plain" | "keychain"`。
- 校验 known hosts。
- 对未知主机展示清晰的主机指纹确认。
- 前端 payload 不携带不必要的敏感信息。
- 导出连接配置时默认不包含密码、私钥内容或私钥口令。
- 导入连接配置时需要校验文件格式，并明确提示是否覆盖已有分组或连接。
- 日志中避免记录密码、私钥、token，或可能包含敏感信息的命令输入。

后续版本要求：

- 使用系统 keychain 保存密码和私钥口令。
- 提供从明文密码到 keychain 的迁移流程。
- 明文密码能力逐步降级为兼容旧配置的读取能力。

## 12. MVP 范围

建议 MVP 包含：

- 一行自绘顶部窗口栏。
- 可折叠左侧连接栏。
- 服务器配置管理。
- 连接导入/导出。
- 新增连接分组。
- 密码/私钥登录。
- 可选保存明文密码，并明确提示安全风险。
- 多 Tab terminal。
- 每个 Terminal Tab 对应一个 SFTP 面板。
- 可折叠 SFTP 面板。
- 可拖拽 Terminal/SFTP 上下分栏。
- 基础 SFTP 操作：
  - 列出目录
  - 上传
  - 下载
  - 删除
  - 重命名
  - 新建文件夹
- 基础服务器监控：
  - CPU
  - 内存
  - 磁盘
  - 负载
  - 运行时间
- 底部状态栏。
- 本地布局状态持久化。

## 13. 后续增强

后续可以考虑：

- 命令面板。
- 远程文件编辑。
- 支持传输暂停/恢复。
- SSH agent 支持。
- Jump host 和 proxy command。
- 端口转发。
- 命令片段和命令模板。
- 单个 Tab 内拆分多个 terminal。
- 工作区导入/导出。
- 非敏感配置的云同步。
- 可选远端 agent，用于更丰富的监控。
