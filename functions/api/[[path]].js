// Routes every /api/* request to the 2DWebsite API (logic lives in _app.js).
import { handle } from './_app.js';
export const onRequest = ({ request, env }) => handle(request, env);
