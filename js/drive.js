// Subida de fotos a Google Drive desde el navegador.
// Usa Google Identity Services (token OAuth) con el alcance "drive.file":
// la app solo ve las carpetas y archivos que ella misma crea.
/* global google */

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
let token = null;
let tokenExp = 0;
let gisLoading = null;

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = resolve;
      s.onerror = () => { gisLoading = null; reject(new Error('No se pudo cargar Google Identity (¿sin conexión?)')); };
      document.head.appendChild(s);
    });
  }
  return gisLoading;
}

export const isConnected = () => token && Date.now() < tokenExp;

export async function connect(clientId) {
  if (!clientId) throw new Error('Falta el Client ID de Google en Ajustes');
  if (isConnected()) return token;
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        token = resp.access_token;
        tokenExp = Date.now() + (resp.expires_in - 60) * 1000;
        resolve(token);
      },
      error_callback: (err) => reject(new Error(err?.message || 'Autorización cancelada')),
    });
    client.requestAccessToken();
  });
}

export function disconnect() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token);
  token = null;
  tokenExp = 0;
}

async function api(path, opts = {}) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`Drive: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

export async function createFolder(name, parentId) {
  const body = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) body.parents = [parentId];
  return api('files?fields=id,name,webViewLink', { method: 'POST', body: JSON.stringify(body) });
}

export async function folderExists(id) {
  try {
    const f = await api(`files/${id}?fields=id,trashed`);
    return f && !f.trashed;
  } catch {
    return false;
  }
}

// "Cualquiera con el link puede editar": así el resto de la cordada sube
// sus fotos directo desde la app de Drive, sin configurar nada.
export async function shareFolder(id, role = 'writer') {
  return api(`files/${id}/permissions`, { method: 'POST', body: JSON.stringify({ role, type: 'anyone' }) });
}

export async function listFolder(id) {
  const q = encodeURIComponent(`'${id}' in parents and trashed = false`);
  const data = await api(`files?q=${q}&orderBy=createdTime desc&pageSize=200&fields=files(id,name,mimeType,thumbnailLink,webViewLink,createdTime,imageMediaMetadata(location))`);
  return data.files || [];
}

// Subida "resumable" (sirve para fotos y videos grandes), con progreso.
export async function upload(file, folderId, onProgress) {
  const init = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,thumbnailLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': file.type || 'application/octet-stream',
      'X-Upload-Content-Length': String(file.size),
    },
    body: JSON.stringify({ name: file.name, parents: [folderId] }),
  });
  if (!init.ok) throw new Error(`Drive: ${init.status}`);
  const location = init.headers.get('Location');
  if (!location) throw new Error('Drive no entregó URL de subida');

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', location);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve(JSON.parse(xhr.responseText)) : reject(new Error(`Drive: ${xhr.status}`)));
    xhr.onerror = () => reject(new Error('Error de red al subir'));
    xhr.send(file);
  });
}
