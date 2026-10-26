import { handleApi } from './api';
export default { fetch(request, env) { return handleApi(request, env.DB, env.ALLOWED_ORIGINS ?? ''); } } satisfies ExportedHandler<Env>;
