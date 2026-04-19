const { app } = require('@azure/functions');

function getClientPrincipal(request) {
  const header =
    request.headers.get('x-ms-client-principal') ||
    request.headers.get('X-MS-CLIENT-PRINCIPAL');

  if (!header) return null;

  try {
    const decoded = Buffer.from(header, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function getGroups(principal) {
  const claims = principal?.claims || [];
  return claims
    .filter(c => (c.typ || '').toLowerCase() === 'groups')
    .map(c => c.val);
}

app.http('analyze', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      const ALLOWED_GROUP_ID = process.env.ALLOWED_GROUP_ID;
      const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

      // ============================================
      // TEMPORAIRE : auth + groupe désactivés pour test
      // ============================================
      // const principal = getClientPrincipal(request);
      // if (!principal) {
      //   return { status: 401, body: 'Non authentifié' };
      // }
      // if (!ALLOWED_GROUP_ID) {
      //   return { status: 500, body: "ALLOWED_GROUP_ID manquant" };
      // }
      // const groups = getGroups(principal);
      // if (!groups.includes(ALLOWED_GROUP_ID)) {
      //   return { status: 403, body: 'Accès refusé (groupe)' };
      // }
      // ============================================

      let body;
      try {
        body = await request.json();
      } catch {
        return { status: 400, body: 'Body JSON invalide' };
      }

      const { data, mime } = body || {};
      if (!data) return { status: 400, body: "Champ 'data' (base64) manquant" };
      if (!ANTHROPIC_API_KEY) return { status: 500, body: 'ANTHROPIC_API_KEY manquante' };

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 1000,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'document',
                  source: {
                    type: 'base64',
                    media_type: mime || 'application/pdf',
                    data
                  }
                },
                {
                  type: 'text',
                  text: `Analyse ce document et retourne UNIQUEMENT un JSON valide :
{"document_type":"INV|STAT|XXX","supplier_name":"...","invoice_number":"...","invoice_date":"YYYY-MM-DD"}

Règles :
- document_type : "STAT" si état de compte / "INV" si facture ou reçu / "XXX" sinon
- supplier_name : nom complet du fournisseur tel qu'écrit
- invoice_number : numéro unique du document
- invoice_date : YYYY-MM-DD`
                }
              ]
            }
          ]
        })
      });

      const payload = await resp.json();

      if (!resp.ok) {
        const msg = payload?.error?.message || `Erreur Anthropic (${resp.status})`;
        return { status: 502, body: msg };
      }

      let text = (payload.content || []).map(x => x.text || '').join('').trim();
      // Nettoyer les backticks markdown que Claude ajoute parfois
      text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        return { status: 502, body: `Réponse IA non-JSON: ${text.slice(0, 200)}` };
      }

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
    } catch (e) {
      return { status: 500, body: e?.message || 'Erreur serveur' };
    }
  }
});
