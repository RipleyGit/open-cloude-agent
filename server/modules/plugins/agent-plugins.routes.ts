import express, { type Request, type Response, type NextFunction } from 'express';
import { agentPluginsService } from './agent-plugins.service.js';

export function createAgentPluginsRouter(): express.Router {
  const router = express.Router();

  const respond = (operation: (req: Request) => unknown | Promise<unknown>) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await operation(req);
        res.json({ success: true, data });
      } catch (error) {
        next(error);
      }
    };

  router.get('/', respond(() => agentPluginsService.list()));

  router.get('/:name/status', respond((req) => {
    const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
    return agentPluginsService.getStatus(name);
  }));

  router.post('/install', respond((req) => agentPluginsService.install(req.body?.url)));

  router.post('/:name/update', respond((req) => {
    const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
    return agentPluginsService.update(name);
  }));

  router.put('/:name/enable', respond((req) => {
    const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
    return agentPluginsService.setEnabled(name, req.body?.enabled);
  }));

  router.delete('/:name', respond((req) => {
    const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
    return agentPluginsService.uninstall(name);
  }));

  return router;
}

export const agentPluginsRoutes = createAgentPluginsRouter();
