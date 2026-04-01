# Raycast GNU sed Substitute Plugin Design

- Date: 2026-04-01
- Status: Draft Approved in Conversation
- Owner: @tenfyzhong

## 1. Goal

实现一个 Raycast 插件命令：用户选中文本后触发快捷键，输入 GNU sed 替换规则，对选中文本进行替换并回写原应用。

核心目标：

1. 规则兼容 GNU sed `s` 命令，尽量完整兼容。
2. 在表单中提供实时预览（基于真实 `gsed` 结果）。
3. 支持最近规则列表和收藏规则列表。
4. 支持收藏规则手动排序。
5. 历史规则去重、置顶、容量上限可配置。

## 2. Scope and Non-Goals

### In Scope

1. 单命令 `Substitute Selected Text`，UI 形态为 `Form`。
2. 输入规则格式：`/pattern/replacement/flags`（无需输入前缀 `s`），并支持自定义分隔符，例如 `#foo#bar#g`。
3. 仅支持单条替换规则（单条 `s` 表达式）。
4. 默认按 GNU sed 逐行语义处理多行文本。
5. 最近规则和收藏规则同时展示在同一个 Form 中。
6. 收藏区提供上移/下移动作进行手动排序。
7. 历史区提供删除单条和清空历史。
8. 历史上限来自 Raycast 全局配置项，默认 `10`。
9. 当 `gsed` 不存在时阻止执行并给出安装引导。
10. 无法读取选中文本时直接报错退出。

### Non-Goals

1. 不支持多条 `-e` 或完整 sed 脚本。
2. 不做“失败规则特殊标记”与筛选。
3. 不支持无选区时手动粘贴输入文本。
4. 不做收藏区拖拽排序（采用上移/下移）。

## 3. UX Flow

### 3.1 Entry

1. 用户在任意支持选区的应用选中文本。
2. 触发 Raycast 命令。
3. 命令启动时立即读取选中文本：
   - 成功：进入 Form。
   - 失败：Toast 报错并退出。

### 3.2 Form Structure

1. Rule 输入框（可编辑）。
2. Original（只读，展示原选区内容）。
3. Preview（只读，展示替换结果或错误信息）。
4. Favorites 区（按自定义顺序）。
5. Recent 区（按最近使用倒序）。
6. 主提交动作 `Apply Replacement`。
7. 只要规则非空即可提交；解析/执行错误由提交后错误处理链路反馈并记录历史。

### 3.3 Rule Usage

1. 手动输入规则：
   - 输入变更后防抖触发预览计算。
2. 从 Favorites/Recent 选择规则：
   - 回填到输入框。
   - 自动刷新预览。
   - 仅在用户点击 `Apply Replacement` 后真正替换。

### 3.4 Manage Lists

1. Favorites 项动作：使用、上移、下移、取消收藏。
2. Recent 项动作：使用、删除该条。
3. Recent 全局动作：清空历史。

## 4. Technical Design

### 4.1 Architecture

单命令 + 本地持久化 + `gsed` 子进程执行：

1. `command` 层：Raycast Form 和 actions。
2. `rule` 层：规则解析、格式校验、构造 sed 表达式。
3. `preview` 层：防抖执行 `gsed` 生成预览。
4. `apply` 层：执行替换并回写原应用（剪贴板 + paste）。
5. `storage` 层：历史和收藏读写、去重、排序、裁剪。
6. `preferences` 层：读取 `historyLimit` 配置。

### 4.2 GNU sed Execution Strategy

选择方案：直接调用本机 `gsed`（推荐方案）。

1. 预览和最终应用都走同一执行路径，保证一致性。
2. 每次预览使用防抖（建议 200ms）。
3. 执行形态：
   - 将当前选中文本作为 stdin 输入。
   - 使用 `gsed -e "<s-expression>"` 输出结果。
4. 若 `gsed` 缺失，提示安装：
   - `brew install gnu-sed`
   - 并说明命令需要 `gsed` 可执行文件。

### 4.3 Rule Parsing

输入：`/foo/bar/g` 或 `#foo#bar#g`

输出：`s/foo/bar/g` 或 `s#foo#bar#g`

规则：

1. 第一个字符作为分隔符。
2. 解析 pattern、replacement、flags 三段。
3. 支持分隔符在 pattern/replacement 中的转义。
4. 解析失败时在 Preview 区显示错误。

### 4.4 Data Model

```ts
type HistoryItem = {
  id: string;
  rawInput: string;
  createdAt: number;
};

type FavoriteItem = {
  id: string;
  rawInput: string;
  order: number;
  createdAt: number;
};
```

存储策略：

1. 历史去重：
   - 插入前若存在同 `rawInput`，删除旧项后插入到头部。
   - 记录时机为用户显式提交一次替换尝试（成功或失败都记录）。
2. 历史容量：
   - 读取 `historyLimit`（默认 10），超出后从尾部裁剪。
3. 收藏独立：
   - 与历史分离存储。
   - 同规则可同时存在于历史和收藏。
4. 收藏排序：
   - 通过 `order` 实现上移/下移。

### 4.5 Apply Back to Source App

执行成功后：

1. 把替换结果写入剪贴板。
2. 触发粘贴动作覆盖当前选区（依赖用户焦点仍在目标应用）。

边界：

1. 如果焦点切走导致未正确粘贴，提示用户重试。
2. 不尝试高级编辑器级 API 集成，维持通用性。

## 5. Error Handling

1. 无选区：报错并退出。
2. `gsed` 缺失：报错并给安装指引。
3. 规则解析失败：显示错误；若用户提交尝试，则失败并记录历史。
4. `gsed` 执行失败：显示 stderr；不回写选区，但记录历史。
5. 替换结果回写失败：报错提示，保留可重试状态。

## 6. Testing Strategy

采用项目标准单元测试（不使用一次性脚本）：

1. `rule parser`：
   - 正常规则、转义分隔符、非法输入。
2. `history manager`：
   - 去重置顶、容量裁剪、删除单条、清空。
3. `favorites manager`：
   - 添加收藏、取消收藏、上移下移边界。
4. `preview runner`：
   - 成功输出、`gsed` 缺失、执行错误。
5. `integration-lite`（可 mock Raycast API）：
   - 选择历史/收藏后回填并刷新预览。
   - 预览失败时仍可提交尝试，提交后失败并入历史。

## 7. Preferences

Raycast Extension Preferences:

1. `historyLimit`（number）
2. 默认值：`10`
3. 生效方式：每次写历史时读取并裁剪

## 8. Implementation Milestones

1. 建立命令骨架与 Form。
2. 完成规则解析与 `gsed` 预览链路。
3. 接入替换回写链路（clipboard + paste）。
4. 接入历史与收藏存储和管理动作。
5. 完成测试与 README 更新。

## 9. Acceptance Criteria

1. 输入 `/foo/bar/g` 可实时看到预览并成功替换回原应用。
2. 输入自定义分隔符规则（如 `#foo#bar#g`）可正确执行。
3. 历史列表无重复，相同规则复用后置顶。
4. 历史数量不超过 `historyLimit`。
5. 收藏支持上移/下移，顺序持久化。
6. 从历史/收藏选择规则后需显示预览，用户确认后才执行。
7. 无选区或缺少 `gsed` 时，行为符合约束（报错退出/安装提示）。
8. 替换尝试失败（语法或执行错误）时，规则仍记录在历史中。
