import { FormEvent, useState } from "react";
import { Check, LockKeyhole, Plus, Search, Trash2, UserCog, Users } from "lucide-react";
import {
  ALL_PERMISSIONS,
  createLocalUser,
  getLocalUsers,
  permissionOptions,
  removeLocalUser,
  updateLocalUser,
  type LocalUser,
  type LocalUserRole,
} from "../lib/localUsers";

const emptyForm = {
  name: "",
  email: "",
  password: "",
  role: "operator" as LocalUserRole,
  active: true,
  permissions: [] as string[],
};

export function AdminUsers() {
  const [users, setUsers] = useState<LocalUser[]>(() => getLocalUsers());
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState("");

  const selectedUser = users.find((user) => user.id === selectedId);
  const filtered = users.filter((user) =>
    `${user.name} ${user.email} ${user.role}`.toLowerCase().includes(query.toLowerCase()),
  );

  function refresh(nextSelectedId = selectedId) {
    setUsers(getLocalUsers());
    setSelectedId(nextSelectedId);
  }

  function resetForm() {
    setForm(emptyForm);
    setSelectedId("");
    setStatus("");
  }

  function selectUser(user: LocalUser) {
    setSelectedId(user.id);
    setStatus("");
    setForm({
      name: user.name,
      email: user.email,
      password: user.password,
      role: user.role,
      active: user.active,
      permissions: user.role === "admin" ? [ALL_PERMISSIONS] : user.permissions,
    });
  }

  function togglePermission(path: string) {
    setForm((current) => {
      if (current.role === "admin") return current;
      const hasPath = current.permissions.includes(path);
      return {
        ...current,
        permissions: hasPath ? current.permissions.filter((item) => item !== path) : [...current.permissions, path],
      };
    });
  }

  function updateRole(role: LocalUserRole) {
    setForm((current) => ({
      ...current,
      role,
      permissions: role === "admin" ? [ALL_PERMISSIONS] : current.permissions.filter((item) => item !== ALL_PERMISSIONS),
    }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus("");

    try {
      if (selectedUser) {
        updateLocalUser(selectedUser.id, {
          name: form.name.trim(),
          email: form.email.trim().toLowerCase(),
          password: form.password.trim(),
          role: form.role,
          active: form.active,
          permissions: form.role === "admin" ? [ALL_PERMISSIONS] : form.permissions,
        });
        setStatus("Usuario atualizado.");
        refresh(selectedUser.id);
        return;
      }

      const created = createLocalUser({
        name: form.name.trim() || form.email.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password.trim(),
        role: form.role,
        active: form.active,
        permissions: form.role === "admin" ? [ALL_PERMISSIONS] : form.permissions,
      });
      setStatus("Usuario criado.");
      refresh(created.id);
      selectUser(created);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Nao foi possivel salvar o usuario.");
    }
  }

  function deleteUser(user: LocalUser) {
    try {
      removeLocalUser(user.id);
      setStatus("Usuario removido.");
      resetForm();
      refresh("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Nao foi possivel remover o usuario.");
    }
  }

  return (
    <main className="page users-page">
      <section className="users-toolbar">
        <div>
          <small>ADMINISTRACAO</small>
          <h3>Usuarios</h3>
          <p>Crie acessos internos e defina o que cada pessoa pode usar.</p>
        </div>
        <button className="button" type="button" onClick={resetForm}>
          <Plus size={17} />
          Novo usuario
        </button>
      </section>

      <section className="users-layout users-layout-balanced">
        <aside className="card users-list-card">
          <div className="users-card-title">
            <div>
              <h3>Equipe</h3>
              <p>{users.length} usuario(s) cadastrados</p>
            </div>
          </div>

          <label className="search-field">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar usuario..." />
          </label>

          <div className="users-list">
            {filtered.map((user) => (
              <button
                className={`user-row ${selectedId === user.id ? "selected" : ""}`}
                key={user.id}
                type="button"
                onClick={() => selectUser(user)}
              >
                <span className="user-avatar">{user.name.slice(0, 2).toUpperCase()}</span>
                <span>
                  <strong>{user.name}</strong>
                  <small>{user.email}</small>
                  <small>{user.role === "admin" ? "Acesso total" : `${user.permissions.length} permissao(oes)`}</small>
                </span>
                <em className={user.active ? "active" : "inactive"}>{user.active ? "Ativo" : "Inativo"}</em>
              </button>
            ))}
          </div>
        </aside>

        <form className="users-editor-stack" onSubmit={handleSubmit}>
          <section className="card users-editor-card users-profile-card">
            <div className="users-card-title">
              <div>
                <h3>{selectedUser ? "Editar usuario" : "Criar usuario"}</h3>
                <p>{form.role === "admin" ? "Administrador tem acesso total." : "Operador acessa apenas as telas marcadas."}</p>
              </div>
              {selectedUser && selectedUser.id !== "local-admin" ? (
                <button className="icon-button danger-icon-button" type="button" onClick={() => deleteUser(selectedUser)} aria-label="Excluir usuario">
                  <Trash2 size={16} />
                </button>
              ) : null}
            </div>

            <div className="users-form-grid">
              <label className="field">
                <span>Nome</span>
                <input className="input" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Nome do usuario" />
              </label>
              <label className="field">
                <span>Email</span>
                <input className="input" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="usuario@empresa.com" />
              </label>
              <label className="field">
                <span>Senha</span>
                <input className="input" type="text" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder="Senha de acesso" />
              </label>
              <label className="field">
                <span>Status</span>
                <select className="input" value={form.active ? "active" : "inactive"} onChange={(event) => setForm((current) => ({ ...current, active: event.target.value === "active" }))}>
                  <option value="active">Ativo</option>
                  <option value="inactive">Inativo</option>
                </select>
              </label>
            </div>

            <div className="users-role-switch">
              <button className={form.role === "admin" ? "selected" : ""} type="button" onClick={() => updateRole("admin")}>
                <LockKeyhole size={17} />
                Admin
              </button>
              <button className={form.role === "operator" ? "selected" : ""} type="button" onClick={() => updateRole("operator")}>
                <UserCog size={17} />
                Operador
              </button>
            </div>
          </section>

          <section className={`card permissions-panel permissions-panel-cards ${form.role === "admin" ? "disabled" : ""}`}>
            <div className="users-card-title compact">
              <div>
                <h3>Funcoes liberadas</h3>
                <p>Escolha os modulos que aparecem para esse usuario.</p>
              </div>
              <strong>{form.role === "admin" ? "Todas" : form.permissions.length}</strong>
            </div>

            {form.role === "admin" ? <div className="admin-access-banner">Admin sempre tem acesso completo a todas as areas da plataforma.</div> : null}

            <div className="permission-section-grid">
              {menuSectionsForPermissions().map((section) => (
                <div className="permission-section-card" key={section.title}>
                  <div className="permission-section-heading">{section.title}</div>
                  <div className="permission-card-grid">
                    {section.items.map((permission) => {
                      const checked = form.role === "admin" || form.permissions.includes(permission.path);
                      return (
                        <button
                          className={`permission-card ${checked ? "checked" : ""}`}
                          disabled={form.role === "admin"}
                          key={permission.path}
                          type="button"
                          onClick={() => togglePermission(permission.path)}
                        >
                          <span>
                            <strong>{permission.label}</strong>
                            <small>{permission.path}</small>
                          </span>
                          <i>{checked ? <Check size={15} /> : null}</i>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {status ? <p className="hint">{status}</p> : null}

            <div className="users-actions">
              <button className="button secondary" type="button" onClick={resetForm}>
                Limpar
              </button>
              <button className="button" type="submit">
                <Users size={17} />
                {selectedUser ? "Salvar alteracoes" : "Criar usuario"}
              </button>
            </div>
          </section>
        </form>
      </section>
    </main>
  );
}

function menuSectionsForPermissions() {
  return permissionOptions.reduce<Array<{ title: string; items: typeof permissionOptions }>>((sections, permission) => {
    const section = sections.find((item) => item.title === permission.section);
    if (section) section.items.push(permission);
    else sections.push({ title: permission.section, items: [permission] });
    return sections;
  }, []);
}
