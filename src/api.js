const BASE = "";

async function parseError(res, method, path) {
  let message = `${method} ${path} failed`;
  try {
    const data = await res.json();
    if (data?.error) message = data.error;
  } catch {}
  return new Error(message);
}

export async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw await parseError(res, "GET", path);
  return res.json();
}

export async function post(path, body = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `POST ${path} failed`);
  return data;
}

export async function put(path, body = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `PUT ${path} failed`);
  return data;
}

export async function del(path) {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `DELETE ${path} failed`);
  return data;
}
