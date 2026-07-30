import { useEffect, useMemo, useState } from "react";
import { ApiError } from "@/api/client";
import { GlassButton, GlassPanel } from "@/components/LiquidGlass";
import { AppDialog } from "@/components/mobile/AppDialog";
import {
  type AdminUserView,
  useAdminUsers,
  useChangePassword,
  useCreateInvite,
  useInvites,
  useResetUserPassword,
  useRevokeInvite,
  useRevokeUserSessions,
  useSession,
  useUpdateUserStatus,
} from "@/hooks/useAuth";
import {
  type LlmRoute,
  useCreateLlmProfile,
  useDeleteLlmProfile,
  useLlmConfig,
  useSaveLlmRoutes,
  useUpdateLlmProfile,
} from "@/hooks/useLlmConfig";
import {
  useFeishuIntegration,
  useTestFeishuNotification,
  useTestFeishuSource,
} from "@/hooks/useIntegrations";

const ROLE_LABEL: Record<string, string> = {
  technical: "技术分析师",
  fundamental: "基本面分析师",
  macro: "宏观分析师",
  sentiment: "情绪分析师",
  bull: "多方辩手",
  bear: "空方辩手",
  judge: "裁判",
  risk: "风险审查员",
};

function errorText(error: unknown, fallback: string) {
  if (!(error instanceof ApiError)) return error ? fallback : null;
  const messages: Record<string, string> = {
    llm_profile_in_use: "该 Profile 正被 Agent 使用，请先调整并保存路由",
    default_profile_must_be_enabled: "默认 Profile 必须保持启用，请先设置新的默认 Profile",
    llm_profile_name_exists: "配置名称已存在",
    current_password_invalid: "当前密码不正确",
    password_unchanged: "新密码需与当前密码不同",
    sole_superadmin: "当前唯一的超级管理员必须保持启用",
    admin_required: "当前账号没有成员管理权限",
  };
  return messages[error.detail] ?? error.detail;
}

export function SettingsPage() {
  const settings = useLlmConfig();
  const session = useSession();
  const isSuperadmin = session.data?.user?.role === "superadmin";
  const create = useCreateLlmProfile();
  const update = useUpdateLlmProfile();
  const remove = useDeleteLlmProfile();
  const saveRoutes = useSaveLlmRoutes();
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiUrl, setApiUrl] = useState("https://openrouter.ai/api/v1/chat/completions");
  const [model, setModel] = useState("openai/gpt-4o-mini");
  const [makeDefault, setMakeDefault] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editProfile, setEditProfile] = useState({ name: "", model: "", api_key: "", api_url: "" });
  const [profileNote, setProfileNote] = useState<string | null>(null);
  const [profileToDelete, setProfileToDelete] = useState<{ id: string; name: string } | null>(null);
  const [routeDraft, setRouteDraft] = useState<Record<string, { profile_id: string; temperature: number }>>({});

  useEffect(() => {
    if (!settings.data) return;
    setRouteDraft(
      Object.fromEntries(settings.data.routes.map((route) => [
        route.role,
        { profile_id: route.profile_id, temperature: route.temperature },
      ])),
    );
  }, [settings.data]);

  const enabledProfiles = useMemo(
    () => settings.data?.profiles.filter((profile) => profile.enabled) ?? [],
    [settings.data?.profiles],
  );

  const onCreate = (event: React.FormEvent) => {
    event.preventDefault();
    create.mutate(
      { name, api_key: apiKey, api_url: apiUrl, model, is_default: makeDefault },
      {
        onSuccess: () => {
          setName("");
          setApiKey("");
          setMakeDefault(false);
        },
      },
    );
  };

  const onSaveRoutes = () => {
    const routes: LlmRoute[] = Object.entries(routeDraft)
      .filter(([, value]) => value.profile_id)
      .map(([role, value]) => ({ role, ...value }));
    saveRoutes.mutate(routes);
  };

  const beginEditProfile = (profile: { id: string; name: string; model: string }) => {
    setEditingProfileId(profile.id);
    setEditProfile({ name: profile.name, model: profile.model, api_key: "", api_url: "" });
    setProfileNote(null);
  };

  const saveProfile = (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingProfileId) return;
    update.mutate(
      {
        id: editingProfileId,
        name: editProfile.name.trim(),
        model: editProfile.model.trim(),
        ...(editProfile.api_key.trim() ? { api_key: editProfile.api_key.trim() } : {}),
        ...(editProfile.api_url.trim() ? { api_url: editProfile.api_url.trim() } : {}),
      },
      {
        onSuccess: () => {
          setEditingProfileId(null);
          setProfileNote("Profile 已更新");
        },
      },
    );
  };

  const createError = errorText(create.error, "模型配置保存失败");
  const routeError = errorText(saveRoutes.error, "Agent 路由保存失败");
  const profileActionError = errorText(update.error ?? remove.error, "Profile 操作失败");

  return (
    <div className="page fade-up">
      <header className="page-head">
        <h1>设置</h1>
        <p className="muted">管理账户、成员、模型与外部集成</p>
      </header>

      {settings.isError && (
        <div className="panel error-state" role="alert">
          模型配置加载失败。<GlassButton tone="text" size="sm" onClick={() => settings.refetch()}>重试</GlassButton>
        </div>
      )}

      <div className="settings-grid settings-grid-wide">
        <div className="settings-main">
          <AccountSettings />
          {isSuperadmin && <MemberSettings />}

          <GlassPanel as="section" className="settings-card" id="llm-profiles">
            <div className="section-heading">
              <div>
                <h2>模型 Profile</h2>
                <p className="muted">密钥仅显示掩码；默认 Profile 供未单独指定的 Agent 与其他 AI 功能使用</p>
              </div>
            </div>

            {settings.isLoading && <p className="muted" aria-live="polite">加载模型配置…</p>}
            <div className="llm-profile-list">
              {settings.data?.profiles.map((profile) => (
                <article className="llm-profile-card" key={profile.id}>
                  <div className="llm-profile-title">
                    <strong>{profile.name}</strong>
                    {profile.is_default && <span className="badge badge-neutral">默认</span>}
                    {!profile.enabled && <span className="badge badge-gap">已停用</span>}
                  </div>
                  <dl className="llm-profile-meta">
                    <div><dt>模型</dt><dd>{profile.model}</dd></div>
                    <div><dt>服务商</dt><dd>{profile.provider_host}</dd></div>
                    <div><dt>密钥</dt><dd><code>{profile.key_hint}</code></dd></div>
                  </dl>
                  {profile.key_status === "invalid" && (
                    <div className="login-error" role="alert">
                      密钥无法解密，请重新填写 API Key 并保存
                    </div>
                  )}
                  {editingProfileId === profile.id && (
                    <form className="settings-form llm-profile-edit" onSubmit={saveProfile}>
                      <div className="form-grid-2">
                        <label>配置名称<input value={editProfile.name} onChange={(event) => setEditProfile({ ...editProfile, name: event.target.value })} /></label>
                        <label>模型<input value={editProfile.model} onChange={(event) => setEditProfile({ ...editProfile, model: event.target.value })} /></label>
                      </div>
                      <label>
                        更换 API Key（留空则保留）
                        <input type="password" autoComplete="new-password" value={editProfile.api_key} onChange={(event) => setEditProfile({ ...editProfile, api_key: event.target.value })} />
                      </label>
                      <label>
                        更换 API URL（留空则保留）
                        <input placeholder={`当前服务：${profile.provider_host ?? "未知"}`} value={editProfile.api_url} onChange={(event) => setEditProfile({ ...editProfile, api_url: event.target.value })} />
                      </label>
                      <div className="button-row">
                        <GlassButton tone="primary" refraction type="submit" disabled={update.isPending || !editProfile.name.trim() || !editProfile.model.trim()}>保存修改</GlassButton>
                        <GlassButton tone="utility" type="button" onClick={() => setEditingProfileId(null)}>取消</GlassButton>
                      </div>
                    </form>
                  )}
                  <div className="button-row">
                    <GlassButton tone="utility" size="sm" onClick={() => beginEditProfile(profile)} disabled={update.isPending}>
                      编辑 / 换 Key
                    </GlassButton>
                    {!profile.is_default && profile.enabled && (
                      <GlassButton tone="utility" size="sm" onClick={() => update.mutate(
                        { id: profile.id, is_default: true },
                        { onSuccess: () => setProfileNote(`${profile.name} 已设为默认 Profile`) },
                      )}>
                        设为默认
                      </GlassButton>
                    )}
                    <GlassButton
                      tone="utility"
                      size="sm"
                      onClick={() => update.mutate(
                        { id: profile.id, enabled: !profile.enabled },
                        { onSuccess: () => setProfileNote(`${profile.name}${profile.enabled ? "已停用" : "已启用"}`) },
                      )}
                      disabled={profile.is_default || update.isPending}
                    >
                      {profile.enabled ? "停用" : "启用"}
                    </GlassButton>
                    <GlassButton
                      tone="danger"
                      size="sm"
                      onClick={() => setProfileToDelete({ id: profile.id, name: profile.name })}
                      disabled={remove.isPending}
                    >
                      删除
                    </GlassButton>
                  </div>
                </article>
              ))}
              {settings.data?.profiles.length === 0 && <p className="empty-copy">还没有模型配置</p>}
            </div>
            {profileActionError && <div className="login-error" role="alert">{profileActionError}</div>}
            {profileNote && <p className="success-copy" role="status">{profileNote}</p>}

            <form className="settings-form llm-profile-form" onSubmit={onCreate}>
              <h3>添加模型 Profile</h3>
              <div className="form-grid-2">
                <label>
                  配置名称
                  <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：DeepSeek 分析组" />
                </label>
                <label>
                  模型
                  <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="模型 ID" />
                </label>
              </div>
              <label>
                API Key
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="sk-…"
                  autoComplete="new-password"
                />
              </label>
              <label>
                API URL
                <input value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} />
                <span className="field-hint">支持 OpenAI-compatible HTTPS endpoint；域名须通过服务端 allowlist</span>
              </label>
              <label className="check-row">
                <input type="checkbox" checked={makeDefault} onChange={(event) => setMakeDefault(event.target.checked)} />
                设为默认 Profile
              </label>
              {createError && <div className="login-error" role="alert">{createError}</div>}
              <GlassButton tone="primary" refraction type="submit" disabled={create.isPending || !name.trim() || !apiKey.trim() || !apiUrl.trim() || !model.trim()}>
                {create.isPending ? "保存中…" : "添加 Profile"}
              </GlassButton>
            </form>
          </GlassPanel>

          <GlassPanel as="section" className="settings-card">
            <div className="section-heading">
              <div>
                <h2>辩论 Agent 路由</h2>
                <p className="muted">各角色可独立选择 API Key、模型和温度；“默认 Profile”会跟随当前默认配置</p>
              </div>
            </div>
            <div className="agent-route-list">
              {settings.data?.available_roles.map((role) => {
                const route = routeDraft[role] ?? { profile_id: "", temperature: 0.3 };
                return (
                  <div className="agent-route-row" key={role}>
                    <label htmlFor={`route-${role}`}>{ROLE_LABEL[role] ?? role}</label>
                    <select
                      id={`route-${role}`}
                      value={route.profile_id}
                      onChange={(event) => setRouteDraft((current) => ({
                        ...current,
                        [role]: { ...route, profile_id: event.target.value },
                      }))}
                    >
                      <option value="">默认 Profile</option>
                      {enabledProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>
                      ))}
                    </select>
                    <label className="temperature-field">
                      <span>温度</span>
                      <input
                        type="number"
                        min="0"
                        max="2"
                        step="0.1"
                        value={route.temperature}
                        onChange={(event) => setRouteDraft((current) => ({
                          ...current,
                          [role]: { ...route, temperature: Number(event.target.value) },
                        }))}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
            {routeError && <div className="login-error" role="alert">{routeError}</div>}
            {saveRoutes.isSuccess && <p className="success-copy" role="status">Agent 路由已保存</p>}
            <GlassButton tone="primary" refraction onClick={onSaveRoutes} disabled={saveRoutes.isPending || enabledProfiles.length === 0}>
              {saveRoutes.isPending ? "保存中…" : "保存 Agent 路由"}
            </GlassButton>
          </GlassPanel>

          {isSuperadmin && <FeishuIntegrationSettings />}
          {isSuperadmin && <InviteSettings />}
        </div>

        <GlassPanel as="aside" tone="data" className="settings-note">
          <h3>账户与数据安全</h3>
          <p>修改密码会保留当前设备，并撤销其他设备的会话。管理员重置密码后，成员需在下次登录时立即改密。</p>
          <h3>多模型调度</h3>
          <p>四名分析师并行工作，多空辩手进行开篇与交叉反驳，随后由裁判和风险审查员完成结论。</p>
          <p>每场辩论保存模型分配快照，后续切换配置不会改变历史报告的审计信息。</p>
          <p>停用正在使用的 Profile 前需先调整角色路由；删除 Profile 后，关联角色回到默认 Profile。</p>
        </GlassPanel>
      </div>
      <AppDialog
        open={Boolean(profileToDelete)}
        title="删除模型 Profile"
        description={<p>将删除 <strong>{profileToDelete?.name}</strong>，关联角色会回到默认 Profile。此操作无法撤销。</p>}
        confirmLabel="确认删除"
        tone="danger"
        pending={remove.isPending}
        onClose={() => setProfileToDelete(null)}
        onConfirm={() => {
          if (!profileToDelete) return;
          const target = profileToDelete;
          remove.mutate(target.id, {
            onSuccess: () => {
              setProfileNote(`${target.name} 已删除；相关角色已回到默认 Profile`);
              setProfileToDelete(null);
            },
          });
        }}
      />
    </div>
  );
}

function AccountSettings() {
  const session = useSession();
  const changePassword = useChangePassword();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const user = session.data?.user;
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const passwordError = errorText(changePassword.error, "密码修改失败");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!newPassword || mismatch) return;
    changePassword.mutate(
      { current_password: currentPassword, new_password: newPassword },
      {
        onSuccess: (result) => {
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
          setNote(result.revoked_count > 0
            ? `密码已更新，并撤销 ${result.revoked_count} 个其他会话`
            : "密码已更新");
        },
      },
    );
  };

  return (
    <GlassPanel
      as="section"
      className={`settings-card account-settings ${user?.must_change_password ? "attention" : ""}`}
      id="account-settings"
    >
      <div className="section-heading">
        <div>
          <h2>账户与密码</h2>
          <p className="muted">{user?.username ?? "当前账户"} · {user?.role === "superadmin" ? "超级管理员" : "成员"}</p>
        </div>
        {user?.must_change_password && <span className="badge badge-gap">需要修改密码</span>}
      </div>
      {user?.must_change_password && (
        <div className="account-security-callout" role="alert">
          管理员已重置你的密码。完成修改后即可继续使用其他功能。
        </div>
      )}
      <form className="settings-form account-password-form" onSubmit={submit}>
        <label>
          当前密码
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </label>
        <div className="form-grid-2">
          <label>
            新密码
            <input
              type="password"
              minLength={8}
              maxLength={256}
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          <label>
            确认新密码
            <input
              type="password"
              minLength={8}
              maxLength={256}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
        </div>
        {mismatch && <div className="login-error" role="alert">两次输入的新密码不一致</div>}
        {passwordError && <div className="login-error" role="alert">{passwordError}</div>}
        {note && <p className="success-copy" role="status">{note}</p>}
        <GlassButton
          tone="primary"
          refraction
          type="submit"
          disabled={changePassword.isPending || currentPassword.length === 0 || newPassword.length < 8 || mismatch}
        >
          {changePassword.isPending ? "修改中…" : "修改密码"}
        </GlassButton>
      </form>
    </GlassPanel>
  );
}

type MemberAction =
  | { kind: "status"; user: AdminUserView; nextStatus: "active" | "disabled" }
  | { kind: "sessions"; user: AdminUserView }
  | { kind: "password"; user: AdminUserView };

function MemberSettings() {
  const session = useSession();
  const users = useAdminUsers(true);
  const updateStatus = useUpdateUserStatus();
  const revokeSessions = useRevokeUserSessions();
  const resetPassword = useResetUserPassword();
  const [action, setAction] = useState<MemberAction | null>(null);
  const [oneTimePassword, setOneTimePassword] = useState<{ username: string; password: string } | null>(null);
  const [copyState, setCopyState] = useState<string | null>(null);
  const mutationError = updateStatus.error ?? revokeSessions.error ?? resetPassword.error;
  const pending = updateStatus.isPending || revokeSessions.isPending || resetPassword.isPending;

  const confirmAction = () => {
    if (!action) return;
    if (action.kind === "status") {
      updateStatus.mutate(
        { id: action.user.id, status: action.nextStatus },
        { onSuccess: () => setAction(null) },
      );
      return;
    }
    if (action.kind === "sessions") {
      revokeSessions.mutate(action.user.id, { onSuccess: () => setAction(null) });
      return;
    }
    resetPassword.mutate(action.user.id, {
      onSuccess: (result) => {
        setOneTimePassword({ username: action.user.username, password: result.one_time_password });
        setAction(null);
      },
    });
  };

  const copyPassword = async () => {
    if (!oneTimePassword) return;
    try {
      await navigator.clipboard.writeText(oneTimePassword.password);
      setCopyState("已复制");
    } catch {
      setCopyState("复制失败，请手动选择");
    }
  };

  const dialogCopy = action?.kind === "status"
    ? {
        title: action.nextStatus === "disabled" ? "停用成员" : "启用成员",
        description: action.nextStatus === "disabled"
          ? `将立即撤销 ${action.user.username} 的全部会话。`
          : `${action.user.username} 将恢复登录权限。`,
        label: action.nextStatus === "disabled" ? "确认停用" : "确认启用",
        tone: action.nextStatus === "disabled" ? "danger" as const : "primary" as const,
      }
    : action?.kind === "sessions"
      ? {
          title: "撤销全部会话",
          description: `${action.user.username} 已登录的设备会立即退出。`,
          label: "确认撤销",
          tone: "danger" as const,
        }
      : action?.kind === "password"
        ? {
            title: "重置成员密码",
            description: `将撤销 ${action.user.username} 的全部会话并生成只显示一次的临时密码。`,
            label: "确认重置",
            tone: "danger" as const,
          }
        : null;

  return (
    <>
      <GlassPanel as="section" className="settings-card member-settings" id="member-settings">
        <div className="section-heading">
          <div>
            <h2>成员与会话</h2>
            <p className="muted">成员状态、最近登录和当前有效会话会在操作后自动回读</p>
          </div>
          <span className="badge badge-neutral">{users.data?.length ?? 0} 个账户</span>
        </div>
        {users.isLoading && <p className="muted" aria-live="polite">加载成员…</p>}
        {users.isError && (
          <div className="login-error" role="alert">
            成员列表加载失败 <GlassButton tone="text" size="sm" onClick={() => users.refetch()}>重试</GlassButton>
          </div>
        )}
        <div className="member-list">
          {users.data?.map((user) => (
            <article className="member-row" key={user.id}>
              <div className="member-identity">
                <strong>{user.username}</strong>
                {user.id === session.data?.user?.id && <span className="badge badge-neutral">当前账户</span>}
                <span className={user.status === "active" ? "badge badge-neutral" : "badge badge-gap"}>
                  {user.status === "active" ? "已启用" : "已停用"}
                </span>
                {user.must_change_password && <span className="badge badge-gap">待改密</span>}
              </div>
              <dl className="member-meta">
                <div><dt>身份</dt><dd>{user.role === "superadmin" ? "超级管理员" : "成员"}</dd></div>
                <div><dt>最近登录</dt><dd>{user.last_login_at ? new Date(user.last_login_at).toLocaleString("zh-CN") : "从未登录"}</dd></div>
                <div><dt>有效会话</dt><dd>{user.active_session_count}</dd></div>
              </dl>
              <div className="button-row member-actions">
                <GlassButton
                  tone="utility"
                  size="sm"
                  onClick={() => setAction({
                    kind: "status",
                    user,
                    nextStatus: user.status === "active" ? "disabled" : "active",
                  })}
                >
                  {user.status === "active" ? "停用" : "启用"}
                </GlassButton>
                <GlassButton tone="utility" size="sm" onClick={() => setAction({ kind: "sessions", user })}>
                  撤销会话
                </GlassButton>
                <GlassButton tone="danger" size="sm" onClick={() => setAction({ kind: "password", user })}>
                  重置密码
                </GlassButton>
              </div>
            </article>
          ))}
        </div>
        {mutationError && <div className="login-error" role="alert">{errorText(mutationError, "成员操作失败")}</div>}
        {oneTimePassword && (
          <div className="one-time-password" role="status">
            <div>
              <strong>{oneTimePassword.username} 的临时密码</strong>
              <p>此密码只显示在当前页面。成员登录后必须立即修改。</p>
            </div>
            <code>{oneTimePassword.password}</code>
            <div className="button-row">
              <GlassButton tone="utility" size="sm" onClick={copyPassword}>复制密码</GlassButton>
              <GlassButton tone="text" size="sm" onClick={() => {
                setOneTimePassword(null);
                setCopyState(null);
              }}>我已保存</GlassButton>
            </div>
            {copyState && <span aria-live="polite">{copyState}</span>}
          </div>
        )}
      </GlassPanel>
      <AppDialog
        open={Boolean(action && dialogCopy)}
        title={dialogCopy?.title ?? "确认操作"}
        description={<p>{dialogCopy?.description}</p>}
        confirmLabel={dialogCopy?.label ?? "确认"}
        tone={dialogCopy?.tone}
        pending={pending}
        onClose={() => setAction(null)}
        onConfirm={confirmAction}
      />
    </>
  );
}

const RUN_STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  running: "执行中",
  succeeded: "已完成",
  partial: "部分完成",
  failed: "失败",
  canceled: "已取消",
};

const DELIVERY_STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  running: "发送中",
  succeeded: "已送达",
  failed: "发送失败",
  skipped: "已跳过",
};

function FeishuIntegrationSettings() {
  const integration = useFeishuIntegration(true);
  const testSource = useTestFeishuSource();
  const testNotification = useTestFeishuNotification();
  const [showNotificationConfirm, setShowNotificationConfirm] = useState(false);

  const source = integration.data?.source;
  const notification = integration.data?.notification;
  const sourceError = errorText(testSource.error, "飞书来源检查失败");
  const notificationError = errorText(testNotification.error, "飞书测试消息发送失败");

  const sendTestNotification = () => {
    testNotification.mutate(undefined, {
      onSuccess: () => setShowNotificationConfirm(false),
    });
  };

  return (
    <>
      <GlassPanel as="section" className="settings-card integration-card" id="feishu-integration">
        <div className="section-heading">
          <div>
            <h2>飞书集成</h2>
            <p className="muted">检查信号文档读取权限与通知通道；页面仅展示配置完整度和脱敏目标</p>
          </div>
          <span className={`integration-health ${source?.configured ? "ready" : "missing"}`}>
            {source?.configured ? "信号源已配置" : "信号源待配置"}
          </span>
        </div>

        {integration.isLoading && <p className="muted">加载飞书集成状态…</p>}
        {integration.isError && (
          <div className="login-error" role="alert">
            飞书集成状态加载失败
            <GlassButton tone="text" size="sm" onClick={() => integration.refetch()}>重试</GlassButton>
          </div>
        )}

        {integration.data && (
          <div className="integration-columns">
            <article className="integration-block">
              <div className="integration-block-head">
                <div>
                  <strong>社群信号来源</strong>
                  <p className="muted">文档元数据权限检查不会读取正文、触发模型或写入信号</p>
                </div>
                <span className={source?.configured ? "badge badge-neutral" : "badge badge-gap"}>
                  {source?.configured ? "配置完整" : "缺少配置"}
                </span>
              </div>
              <dl className="integration-meta">
                <div><dt>资源</dt><dd>{source?.resource_kind === "configured" ? "已配置文档" : "暂无"}</dd></div>
                <div>
                  <dt>最近同步</dt>
                  <dd>
                    {source?.latest_run
                      ? `${RUN_STATUS_LABEL[source.latest_run.status] ?? source.latest_run.status} · ${source.latest_run.written_count} 个新版本`
                      : "尚无运行"}
                  </dd>
                </div>
              </dl>
              <GlassButton
                tone="utility"
                size="sm"
                disabled={!source?.configured || testSource.isPending}
                onClick={() => testSource.mutate()}
              >
                {testSource.isPending ? "检查中…" : "检查读取权限"}
              </GlassButton>
              {testSource.data && (
                <p className="success-copy" role="status">
                  已读取文档元数据：{testSource.data.title}
                  {testSource.data.revision_id ? ` · 修订 ${testSource.data.revision_id}` : ""}
                </p>
              )}
              {sourceError && <div className="login-error" role="alert">{sourceError}</div>}
            </article>

            <article className="integration-block">
              <div className="integration-block-head">
                <div>
                  <strong>通知通道</strong>
                  <p className="muted">支持群机器人 webhook 或应用机器人；测试会发送一条真实消息</p>
                </div>
                <span className={notification?.channel ? "badge badge-neutral" : "badge badge-gap"}>
                  {notification?.channel ? "通道可用" : "通道待配置"}
                </span>
              </div>
              <dl className="integration-meta">
                <div><dt>通道</dt><dd>{notification?.channel ?? "暂无"}</dd></div>
                <div><dt>目标</dt><dd>{notification?.target_hint ?? "暂无"}</dd></div>
                <div>
                  <dt>最近投递</dt>
                  <dd>
                    {notification?.latest_delivery
                      ? DELIVERY_STATUS_LABEL[notification.latest_delivery.status] ?? notification.latest_delivery.status
                      : "尚无投递"}
                  </dd>
                </div>
              </dl>
              <GlassButton
                tone="utility"
                size="sm"
                disabled={!notification?.channel || testNotification.isPending}
                onClick={() => setShowNotificationConfirm(true)}
              >
                发送测试消息
              </GlassButton>
              {testNotification.data && <p className="success-copy" role="status">测试消息已送达 {testNotification.data.target_hint}</p>}
              {notificationError && <div className="login-error" role="alert">{notificationError}</div>}
            </article>
          </div>
        )}
      </GlassPanel>

      <AppDialog
        open={showNotificationConfirm}
        title="确认发送真实消息"
        description={(
          <p>系统将向 <strong>{notification?.target_hint ?? "已配置目标"}</strong> 发送一条“投研工作台连接测试”消息，并记录投递结果。</p>
        )}
        confirmLabel="确认发送"
        pending={testNotification.isPending}
        onConfirm={sendTestNotification}
        onClose={() => setShowNotificationConfirm(false)}
      />
    </>
  );
}

function InviteSettings() {
  const invites = useInvites(true);
  const create = useCreateInvite();
  const revoke = useRevokeInvite();
  const [hint, setHint] = useState("");
  const [ttl, setTtl] = useState(72);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<string | null>(null);
  const [inviteToRevoke, setInviteToRevoke] = useState<{ id: string; hint: string } | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    create.mutate({ hint, ttl_hours: ttl }, {
      onSuccess: (result) => {
        setNewCode(result.code);
        setHint("");
      },
    });
  };

  const copyCode = async () => {
    if (!newCode) return;
    try {
      await navigator.clipboard.writeText(newCode);
      setCopyState("已复制");
    } catch {
      setCopyState("复制失败，请手动选择邀请码");
    }
  };

  return (
    <>
      <GlassPanel as="section" className="settings-card">
      <div className="section-heading">
        <div><h2>成员邀请码</h2><p className="muted">明文只在创建后显示一次，有效期内可重复使用</p></div>
      </div>
      {newCode && (
        <div className="invite-code-result" role="status">
          <span>新邀请码</span><code>{newCode}</code>
          <GlassButton tone="utility" size="sm" onClick={copyCode}>复制</GlassButton>
          {copyState && <span aria-live="polite">{copyState}</span>}
        </div>
      )}
      <form className="invite-form" onSubmit={submit}>
        <label>备注<input value={hint} maxLength={32} onChange={(event) => setHint(event.target.value)} placeholder="例如：家人账号" /></label>
        <label>有效小时<input type="number" min="1" max="720" value={ttl} onChange={(event) => setTtl(Number(event.target.value))} /></label>
        <GlassButton tone="primary" refraction type="submit" disabled={create.isPending}>{create.isPending ? "生成中…" : "生成邀请码"}</GlassButton>
      </form>
      {create.error && <div className="login-error" role="alert">{errorText(create.error, "邀请码生成失败")}</div>}
      {invites.isLoading && <p className="muted">加载邀请码…</p>}
      {invites.isError && <div className="login-error" role="alert">邀请码列表加载失败 <GlassButton tone="text" size="sm" onClick={() => invites.refetch()}>重试</GlassButton></div>}
      <div className="invite-list">
        {invites.data?.map((invite) => {
          const expired = new Date(invite.expires_at).getTime() <= Date.now();
          return (
            <div key={invite.id}>
              <code>{invite.code_hint}</code>
              <span>
                {invite.revoked_at
                  ? "已撤销"
                  : expired
                    ? "已过期"
                    : `有效至 ${new Date(invite.expires_at).toLocaleString("zh-CN")}`}
              </span>
              {!invite.revoked_at && !expired && (
                <GlassButton
                  tone="danger"
                  size="sm"
                  disabled={revoke.isPending}
                  onClick={() => setInviteToRevoke({ id: invite.id, hint: invite.code_hint })}
                >
                  撤销
                </GlassButton>
              )}
            </div>
          );
        })}
        {invites.data?.length === 0 && <p className="empty-copy">暂无邀请码</p>}
      </div>
      {revoke.error && <div className="login-error" role="alert">{errorText(revoke.error, "邀请码撤销失败")}</div>}
      </GlassPanel>
      <AppDialog
        open={Boolean(inviteToRevoke)}
        title="撤销邀请码"
        description={<p>邀请码 <strong>{inviteToRevoke?.hint}</strong> 将立即失效，已注册成员不受影响。</p>}
        confirmLabel="确认撤销"
        tone="danger"
        pending={revoke.isPending}
        onClose={() => setInviteToRevoke(null)}
        onConfirm={() => {
          if (!inviteToRevoke) return;
          revoke.mutate(inviteToRevoke.id, { onSuccess: () => setInviteToRevoke(null) });
        }}
      />
    </>
  );
}
