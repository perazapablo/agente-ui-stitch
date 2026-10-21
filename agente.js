import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const SYSTEM_PROMPT = `Eres un Ingeniero Frontend y Experto en UX/UI.
Tu objetivo es traducir los requerimientos del usuario en interfaces funcionales
usando las herramientas de Stitch.
Reglas:
1. Analiza el requerimiento y decide qué herramientas usar.
2. Si una herramienta falla, lee el error, ajusta los parámetros y vuelve a intentarlo.
3. Informa al usuario de tus acciones de forma concisa.`;

const USER_PROMPT = `Crea un proyecto nuevo y genera una pantalla de inicio de sesión con un botón azul
oscuro, la cual reciba un usuario y password, así como las opciones de
registrarse, olvidé mi contraseña y recordar sesión siempre.`;

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

let mensajes = [
  { role: "system", content: SYSTEM_PROMPT },
  { role: "user", content: USER_PROMPT },
];

let tareaCompletada = false;

async function iniciarAgente() {
  console.log("🔌 Iniciando conexión con Stitch MCP...");

  // 1. Levantar el servidor local de Stitch
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "@google/stitch-sdk"],
  });

  const mcpClient = new Client({ name: "agente-stitch", version: "1.0" }, { capabilities: {} });
  await mcpClient.connect(transport);

  // 2. Leer y traducir las herramientas de MCP para OpenRouter
  const mcpTools = await mcpClient.listTools();
  const openRouterTools = mcpTools.tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
  console.log(`✅ Conexión exitosa. ${openRouterTools.length} herramientas disponibles.`);

  // 3. El Bucle del Agente (Agentic Loop)
  while (!tareaCompletada) {
    const respuesta = await openai.chat.completions.create({
      model: "anthropic/claude-3.5-sonnet", // Se usa Claude a través de OpenRouter
      messages: mensajes,
      tools: openRouterTools,
    });

    const mensajeModelo = respuesta.choices[0].message;
    mensajes.push(mensajeModelo);

    // Si el modelo decide usar una herramienta de Stitch
    if (mensajeModelo.tool_calls && mensajeModelo.tool_calls.length > 0) {
      for (const toolCall of mensajeModelo.tool_calls) {
        console.log(`🛠 Acción del Agente -> Ejecutando: ${toolCall.function.name}`);

        try {
          const argumentos = JSON.parse(toolCall.function.arguments);

          // Ejecutar la acción en la máquina local
          const resultado = await mcpClient.callTool({
            name: toolCall.function.name,
            arguments: argumentos,
          });

          // Devolver el resultado de la herramienta a la memoria del LLM
          mensajes.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
            content: JSON.stringify(resultado),
          });

          console.log(`✅ Acción completada con éxito.`);
        } catch (error) {
          console.log(`⚠️ Error en la herramienta: ${error.message}. Informando al agente para que corrija...`);
          mensajes.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
            content: `Error: ${error.message}`,
          });
        }
      }
    } else {
      // Si ya no usa herramientas, significa que terminó el trabajo y nos responde con texto
      console.log(`\n🎉 Agente: ${mensajeModelo.content}`);
      tareaCompletada = true;
    }
  }

  await mcpClient.close();
}

iniciarAgente().catch(console.error);
