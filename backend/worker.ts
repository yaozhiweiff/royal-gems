import { handleApi, type Database } from './api';
export default { fetch(request: Request, env: { DB: Database; ALLOWED_ORIGINS: string }) { return handleApi(request, env.DB, env.ALLOWED_ORIGINS ?? ''); } };
