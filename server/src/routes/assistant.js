import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { answer, assistantInfo } from '../services/assistant.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.json(assistantInfo());
});

router.post('/', async (req, res) => {
  const messages = (Array.isArray(req.body?.messages) ? req.body.messages : [])
    .filter((m) => ['user', 'assistant'].includes(m?.role) && typeof m.content === 'string' && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, 2000) }));
  // Claude API sohbetin kullanıcı mesajıyla başlamasını ister
  while (messages[0]?.role === 'assistant') messages.shift();
  res.json(await answer(req.user, messages));
});

export default router;
