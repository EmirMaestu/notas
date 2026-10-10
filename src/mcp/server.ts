import { McpServer } from '@modelcontextprotocol/server';
import type { DB } from '@/db/types';
import { TOOLS, callTool } from './tools';

export const MCP_INSTRUCTIONS = [
  'Notas es el gestor de tareas del usuario: listas (con una Bandeja fija), tareas con fecha, hora, prioridad, etiquetas y subtareas, y listas compartidas con otras personas.',
  'Las fechas son YYYY-MM-DD y las horas HH:mm (24 hs), siempre en la zona horaria del usuario: llamá a get_today_context antes de interpretar "hoy", "mañana" o días de la semana.',
  'Prioridades: 0 ninguna, 1 baja, 3 media, 5 alta. Una tarea sin lista va a la Bandeja.',
  'Borrar una tarea la manda a la papelera por 30 días (restore_task la recupera).',
  'Para asignar tareas o compartir listas se usan emails de personas registradas en Notas.',
].join('\n');

/** Servidor MCP de un request: cada herramienta corre en nombre de `userId`. */
export function createNotasMcpServer(db: DB, userId: string): McpServer {
  const server = new McpServer({ name: 'notas', version: '1.0.0' }, { instructions: MCP_INSTRUCTIONS });
  for (const tool of TOOLS) {
    server.registerTool(tool.name, {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.input,
      annotations: {
        readOnlyHint: tool.readOnly,
        destructiveHint: tool.destructive,
        idempotentHint: tool.idempotent,
        openWorldHint: false,
      },
    }, (args) => callTool({ db, userId }, tool.name, args));
  }
  return server;
}
