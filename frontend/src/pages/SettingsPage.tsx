import { useEffect, useMemo, useState } from "react";
import { ApiError } from "@/api/client";
import { useCreateInvite, useInvites, useRevokeInvite, useSession } from "@/hooks/useAuth";
import {
  type LlmRoute,
  useCreateLlmProfile,
  useDeleteLlmProfile,
  useLlmConfig,
  useSaveLlmRoutes,
  useUpdateLlmProfile,
} from "@/hooks/useLlmConfig";

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
        <p className="muted">保存多个加密 API Key 与模型，并为每个辩论 Agent 指定模型</p>
      </header>

      {settings.isError && (
        <div className="panel error-state" role="alert">
          模型配置加载失败。<button className="text-button" onClick={() => settings.refetch()}>重试</button>
        </div>
      )}

      <div className="settings-grid settings-grid-wide">
        <div className="settings-main">
          <section className="panel settings-card">
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
                        <button className="btn" disabled={update.isPending || !editProfile.name.trim() || !editProfile.model.trim()}>保存修改</button>
                        <button className="btn btn-ghost" type="button" onClick={() => setEditingProfileId(null)}>取消</button>
                      </div>
                    </form>
                  )}
                  <div className="button-row">
                    <button className="btn btn-ghost" onClick={() => beginEditProfile(profile)} disabled={update.isPending}>
                      编辑 / 换 Key
                    </button>
                    {!profile.is_default && profile.enabled && (
                      <button className="btn btn-ghost" onClick={() => update.mutate(
                        { id: profile.id, is_default: true },
                        { onSuccess: () => setProfileNote(`${profile.name} 已设为默认 Profile`) },
                      )}>
                        设为默认
                      </button>
                    )}
                    <button
                      className="btn btn-ghost"
                      onClick={() => update.mutate(
                        { id: profile.id, enabled: !profile.enabled },
                        { onSuccess: () => setProfileNote(`${profile.name}${profile.enabled ? "已停用" : "已启用"}`) },
                      )}
                      disabled={profile.is_default || update.isPending}
                    >
                      {profile.enabled ? "停用" : "启用"}
                    </button>
                    <button
                      className="btn btn-danger-ghost"
                      onClick={() => window.confirm(`删除模型配置“${profile.name}”？`) && remove.mutate(
                        profile.id,
                        { onSuccess: () => setProfileNote(`${profile.name} 已删除；相关角色已回到默认 Profile`) },
                      )}
                      disabled={remove.isPending}
                    >
                      删除
                    </button>
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
              <button className="btn" type="submit" disabled={create.isPending || !name.trim() || !apiKey.trim() || !apiUrl.trim() || !model.trim()}>
                {create.isPending ? "保存中…" : "添加 Profile"}
              </button>
            </form>
          </section>

          <section className="panel settings-card">
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
            <button className="btn" onClick={onSaveRoutes} disabled={saveRoutes.isPending || enabledProfiles.length === 0}>
              {saveRoutes.isPending ? "保存中…" : "保存 Agent 路由"}
            </button>
          </section>

          {isSuperadmin && <InviteSettings />}
        </div>

        <aside className="panel settings-note">
          <h3>多模型调度</h3>
          <p>四名分析师并行工作，多空辩手进行开篇与交叉反驳，随后由裁判和风险审查员完成结论。</p>
          <p>每场辩论保存模型分配快照，后续切换配置不会改变历史报告的审计信息。</p>
          <p>停用正在使用的 Profile 前需先调整角色路由；删除 Profile 后，关联角色回到默认 Profile。</p>
        </aside>
      </div>
    </div>
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
    <section className="panel settings-card">
      <div className="section-heading"><div><h2>成员邀请码</h2><p className="muted">明文只在创建后显示一次</p></div></div>
      {newCode && (
        <div className="invite-code-result" role="status">
          <span>新邀请码</span><code>{newCode}</code>
          <button className="btn btn-ghost" onClick={copyCode}>复制</button>
          {copyState && <span aria-live="polite">{copyState}</span>}
        </div>
      )}
      <form className="invite-form" onSubmit={submit}>
        <label>备注<input value={hint} maxLength={32} onChange={(event) => setHint(event.target.value)} placeholder="例如：家人账号" /></label>
        <label>有效小时<input type="number" min="1" max="720" value={ttl} onChange={(event) => setTtl(Number(event.target.value))} /></label>
        <button className="btn" type="submit" disabled={create.isPending}>{create.isPending ? "生成中…" : "生成邀请码"}</button>
      </form>
      {create.error && <div className="login-error" role="alert">{errorText(create.error, "邀请码生成失败")}</div>}
      {invites.isLoading && <p className="muted">加载邀请码…</p>}
      {invites.isError && <div className="login-error" role="alert">邀请码列表加载失败 <button onClick={() => invites.refetch()}>重试</button></div>}
      <div className="invite-list">
        {invites.data?.map((invite) => (
          <div key={invite.id}>
            <code>{invite.code_hint}</code>
            <span>{invite.used_at ? "已使用" : invite.revoked_at ? "已撤销" : `有效至 ${new Date(invite.expires_at).toLocaleString("zh-CN")}`}</span>
            {!invite.used_at && !invite.revoked_at && new Date(invite.expires_at).getTime() > Date.now() && (
              <button
                className="link-action"
                disabled={revoke.isPending}
                onClick={() => window.confirm(`撤销邀请码“${invite.code_hint}”？`) && revoke.mutate(invite.id)}
              >
                撤销
              </button>
            )}
          </div>
        ))}
        {invites.data?.length === 0 && <p className="empty-copy">暂无邀请码</p>}
      </div>
      {revoke.error && <div className="login-error" role="alert">{errorText(revoke.error, "邀请码撤销失败")}</div>}
    </section>
  );
}
