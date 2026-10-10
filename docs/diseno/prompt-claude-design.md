Diseñá la interfaz completa de **Notas**, una app web de tareas personal y compartida, inspirada en el flujo de TickTick pero con identidad propia. Es una app que ya existe y funciona; necesito un rediseño visual y de experiencia que después voy a implementar en código. Todo el texto de la interfaz va en **español rioplatense** (voseo: "Agregá", "Probá de nuevo").

## Qué es y para quién

- Gestor de tareas para una persona y su círculo chico (pareja, socios, equipo de 2–5). Se usa todo el día, desde la compu y el celular.
- Su diferencial: **se maneja también desde asistentes de IA** (Claude, ChatGPT) por MCP. La IA crea, completa y mueve tareas; la web tiene que mostrar esos cambios con claridad y transmitir confianza.
- Sensación buscada: **calma, foco y rapidez**. Herramienta de uso diario, no un dashboard corporativo. Densa sin estar abarrotada; nada de adornos que estorben.

## Lo que no funciona del diseño actual

Hoy se ve genérico y plano: barra lateral gris, lista de filas sin jerarquía, panel de detalle que parece un formulario, colores sin personalidad (violeta por defecto). Quiero algo con carácter: buena tipografía, jerarquía clara, ritmo de espaciado consistente, micro-interacciones cuidadas y un color de acento propio.

## Estructura (mantener)

Layout de 3 columnas en escritorio:
1. **Barra lateral** (navegación).
2. **Lista de tareas** de la vista elegida, con campo de agregado rápido arriba.
3. **Panel de detalle** de la tarea seleccionada (se abre al tocar una tarea).

En celular: una sola columna; la barra lateral es un cajón y el detalle ocupa la pantalla completa con botón para volver.

## Pantallas y estados a diseñar

1. **Login** y **Registro** (email, contraseña, nombre opcional, código de invitación; el registro es solo con invitación). Estados de error ("Email o contraseña incorrectos", "Demasiados intentos. Esperá unos minutos.").
2. **Vista "Hoy"** con tareas agrupadas: *Vencidas* (en rojo), *Hoy*. Mostrar 6–8 tareas variadas.
3. **Vista "Próximos 7 días"** agrupada por día: Vencidas, Hoy, Mañana, "Lunes 12/10", etc.
4. **Vista de una lista** (p. ej. "Casa") sin agrupar, mostrando el nombre de la lista y, si es compartida, los avatares de los miembros.
5. **Bandeja**, **Asignadas a mí**, **Completadas** (tareas tachadas con fecha de completado), **Papelera** (tareas borradas, se eliminan a los 30 días, botón Restaurar).
6. **Vista por etiqueta** (#casa).
7. **Panel de detalle** de una tarea completa: checkbox, título editable, fecha y hora, prioridad, lista, asignada a, descripción, subtareas (checklist con progreso 2/5), etiquetas propias y "de otros miembros", botón "Mandar a la papelera".
8. **Diálogo de lista** (crear/editar): nombre, color (9 opciones), carpeta (o nueva carpeta), sección **Miembros** (agregar por email, quitar). Variante para un miembro que no es dueño: solo lectura + "Salir de la lista".
9. **Configuración**: cuenta, zona horaria, **Conexión con IA** (URL del MCP con botón copiar, crear token personal que se muestra una sola vez, lista de tokens con "Revocar", lista de apps conectadas por OAuth —p. ej. "Claude", "ChatGPT"— con último uso y "Desconectar"), cerrar sesión.
10. **Pantalla de consentimiento OAuth**: "Claude quiere acceder a tus tareas de Notas" con a dónde va a volver, qué podrá hacer, y botones Permitir / Cancelar. Variante de error ("Esta solicitud no es válida" con link "Volver a claude.ai"). Tiene que transmitir seguridad.
11. **Estados vacíos** de cada vista (con un mensaje amable y una acción), **cargando** y **error**.
12. Versión **celular** de: Hoy, detalle de tarea y cajón de navegación.

## Elementos y comportamiento

- **Barra lateral:** vistas fijas (Bandeja, Hoy, Próximos 7 días, Asignadas a mí, Completadas, Papelera); sección "Listas" con carpetas plegables y listas con punto de color; ícono que indica lista compartida; sección "Compartidas conmigo"; sección "Etiquetas"; abajo, Configuración y el email del usuario. Mostrar contador de pendientes en Hoy y Bandeja.
- **Agregado rápido:** un campo que entiende lenguaje natural: `Pagar luz mañana !alta #casa`. Mientras se escribe, muestra chips con lo que detectó (fecha "Mañana", "Prioridad alta", "#casa"). Enter crea la tarea.
- **Fila de tarea:** checkbox cuyo borde indica la prioridad (alta = rojo, media = ámbar, baja = azul, ninguna = gris); título; contador de subtareas (1/3); etiquetas; nombre de la lista (en vistas mixtas); fecha relativa ("Hoy", "Mañana", "Lun", "20/10") en rojo si está vencida, con hora si tiene; avatar con iniciales del asignado si la lista es compartida. Estados: normal, hover, seleccionada, completada (tachada, atenuada), con foco de teclado.
- **Completar** una tarea tiene que sentirse satisfactorio (animación breve del checkbox y la fila saliendo de la vista).
- **Prioridades:** 4 niveles (ninguna, baja, media, alta).
- **Asignación:** solo en listas compartidas; avatar con iniciales y color estable por persona.
- Opcional, si suma: un indicador sutil de "creada/modificada por IA" en la fila o en el detalle.

## Requisitos de diseño

- **Tema claro y oscuro**, ambos de primera (no un claro invertido). Definí los colores como tokens (fondo, superficie, texto, texto atenuado, borde, hover, seleccionado, acento, peligro, prioridades) con valores para cada tema.
- **Tipografía:** proponé una familia de Google Fonts y una escala (tamaños, pesos, interlineado). Los números de fechas y contadores con cifras tabulares.
- **Accesibilidad WCAG AA:** contraste suficiente en ambos temas, foco visible en todo, áreas táctiles de al menos 44 px en celular, nada que dependa solo del color (la prioridad también se distingue de otra forma, p. ej. ícono o etiqueta en el detalle).
- **Responsive** desde 360 px hasta escritorio ancho (en pantallas grandes la lista no se estira infinito).
- Íconos de **Lucide**.
- Implementable con **Tailwind CSS 4 + React** (Next.js): evitá efectos que no se puedan reproducir con CSS (nada de ilustraciones complejas ni fondos con imágenes pesadas).

## Datos de ejemplo para los mockups

Usuario: Emir (emir@…). Listas: Casa (verde), Trabajo (azul, compartida con Sofía y Martín), Compras (ámbar, compartida con Sofía), Facultad (violeta, en la carpeta "Personal"). Etiquetas: #casa, #urgente, #llamadas, #finde. Tareas: "Pagar la luz" (hoy, alta, #casa), "Llamar al contador" (vencida ayer, media, #llamadas), "Revisar presupuesto Q4" (hoy 15:00, alta, Trabajo, asignada a Martín, subtareas 1/3), "Comprar yerba y pan" (mañana, Compras, asignada a Sofía), "Entregar TP de Bases de Datos" (jueves, alta, Facultad), "Cortar el pasto" (sábado, baja, #finde), "Renovar el DNI" (sin fecha).

## Qué necesito que me entregues

1. Los mockups de las pantallas y estados de arriba, en claro y oscuro (escritorio) y las tres pantallas de celular.
2. Una hoja de **tokens de diseño** (colores por tema, tipografía, espaciado, radios, sombras, duraciones de animación).
3. Los **componentes** con sus variantes y estados: fila de tarea, checkbox de prioridad, chip de etiqueta, avatar, ítem de navegación, campo de agregado rápido, botones (primario, secundario, peligro, fantasma), inputs, select, diálogo, toast.
4. Notas breves de interacción (qué pasa al completar, al abrir el detalle, al borrar con opción de deshacer).
