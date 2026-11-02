// pluginsRoutes: used by the server entrypoint to mount protected plugin-management endpoints.
export { pluginsRoutes } from './plugins.module.js';
export { agentPluginsRoutes } from './agent-plugins.routes.js';
export { agentPluginsService } from './agent-plugins.service.js';

// startEnabledPluginServers: used by the server entrypoint to start enabled plugin subprocesses.
export { registerEnabledAgentPlugins, startEnabledPluginServers } from './plugin-process.service.js';
// stopAllPlugins: used by the server entrypoint to stop plugin subprocesses during shutdown.
export { stopAllPlugins } from './plugin-process.service.js';
// getPluginPort: used by WebSocket setup in the server entrypoint to proxy plugin connections.
export { getPluginPort } from './plugin-process.service.js';
