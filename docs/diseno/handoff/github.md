repo: EmirMaestu/notas
branch: master
path: src

## Last sync
date: 2026-10-10T21:24:25Z

### Updated in this project
- Rediseño visual completo (claro/oscuro) a partir de los componentes y copys actuales
- Tokens de diseño nuevos (acento petróleo, Manrope + Geist Mono)
- Componentes con variantes y estados, notas de interacción

## Screen map
| Screen | Repo files |
| --- | --- |
| Barra lateral (NotasSidebar) | src/components/sidebar.tsx, src/components/app-shell.tsx |
| Lista / fila de tarea (NotasLista) | src/components/task-list.tsx, src/components/task-item.tsx, src/components/priority-checkbox.tsx, src/lib/format.ts |
| Detalle de tarea (NotasDetalle) | src/components/task-detail.tsx, src/components/subtask-list.tsx, src/components/tag-editor.tsx |
| Agregado rápido | src/components/quick-add.tsx, src/core/quick-add.ts |
| Login / Registro | src/components/auth-form.tsx |
| Diálogo de lista | src/components/list-dialog.tsx, src/components/list-members.tsx |
| Configuración / Conexión con IA | src/app/app/settings/page.tsx, src/components/ai-connection.tsx |
| Consentimiento OAuth | src/app/oauth/authorize/page.tsx, src/lib/oauth-consent.ts |
| Tokens | src/app/globals.css |
