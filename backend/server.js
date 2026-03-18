require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// Configurar Firebase Admin
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${process.env.FIREBASE_CLIENT_EMAIL}`
};

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('✅ Firebase Admin inicializado');
} catch (error) {
  console.error('❌ Erro ao inicializar Firebase:', error.message);
}

const db = admin.firestore();
const app = express();

// Middlewares
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Rotas básicas
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Bruna Presente API - Mercado Pago Integration',
    version: '1.0.0',
    endpoints: {
      createPix: 'POST /api/payments/create-pix',
      getPayment: 'GET /api/payments/:id',
      webhook: 'POST /api/webhooks/mercadopago'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    firebase: admin.apps.length > 0 ? 'connected' : 'disconnected',
    mercadopago: process.env.MERCADOPAGO_ACCESS_TOKEN ? 'configured' : 'not configured'
  });
});

// Rotas de pagamento
const paymentsRouter = require('./routes/payments')(db);
app.use('/api/payments', paymentsRouter);

// Webhook Mercado Pago
app.post('/api/webhooks/mercadopago', async (req, res) => {
  try {
    console.log('📬 Webhook recebido:', JSON.stringify(req.body, null, 2));
    
    // Responder imediatamente (obrigatório)
    res.status(200).send('OK');
    
    const { action, data, type } = req.body;
    
    if (type === 'payment' && action === 'payment.updated') {
      const mercadopago = require('mercadopago');
      mercadopago.configure({
        access_token: process.env.MERCADOPAGO_ACCESS_TOKEN
      });
      
      const payment = await mercadopago.payment.get(data.id);
      console.log('💳 Status do pagamento:', payment.body.status);
      
      if (payment.body.external_reference) {
        const pedidoId = payment.body.external_reference;
        let novoStatus = 'aguardando_pagamento';
        
        switch (payment.body.status) {
          case 'approved':
            novoStatus = 'confirmado';
            break;
          case 'rejected':
          case 'cancelled':
            novoStatus = 'cancelado';
            break;
          case 'pending':
          case 'in_process':
            novoStatus = 'aguardando_pagamento';
            break;
        }
        
        await db.collection('pedidos').doc(pedidoId).update({
          status: novoStatus,
          mercadoPagoPaymentId: data.id,
          mercadoPagoStatus: payment.body.status,
          dataAtualizacao: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`✅ Pedido ${pedidoId} atualizado para: ${novoStatus}`);
      }
    }
  } catch (error) {
    console.error('❌ Erro no webhook:', error);
  }
});

// Error handlers
app.use((err, req, res, next) => {
  console.error('❌ Erro:', err);
  res.status(500).json({
    error: true,
    message: err.message || 'Erro interno do servidor'
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: true,
    message: 'Rota não encontrada'
  });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║   🎁 BRUNA PRESENTE API                ║
║   🚀 Servidor rodando na porta ${PORT}    ║
║   🔵 Mercado Pago integrado            ║
║   🔥 Firebase conectado                ║
╚═══════════════════════════════════════╝

📡 Acesse: http://localhost:${PORT}
💚 Health: http://localhost:${PORT}/health
  `);
});

module.exports = app;