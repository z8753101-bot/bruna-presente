const express = require('express');
const { MercadoPagoConfig, Payment } = require('mercadopago');

module.exports = (db) => {
  const router = express.Router();
  
  // Configurar Mercado Pago (versão 2.x)
  const client = new MercadoPagoConfig({
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN,
    options: { timeout: 5000 }
  });
  
  const payment = new Payment(client);
  
  // Criar pagamento PIX
  router.post('/create-pix', async (req, res) => {
    try {
      const { pedidoId, valor, email, nome } = req.body;
      
      // Validações
      if (!pedidoId || !valor || valor <= 0) {
        return res.status(400).json({
          error: true,
          message: 'Dados inválidos: pedidoId e valor são obrigatórios'
        });
      }
      
      console.log(`💰 Criando pagamento PIX - Pedido: ${pedidoId} - Valor: R$ ${valor}`);
      
      // Criar pagamento PIX
      const paymentData = {
        transaction_amount: parseFloat(valor),
        description: `Pedido #${pedidoId.substring(0, 8).toUpperCase()} - Bruna Presente`,
        payment_method_id: 'pix',
        external_reference: pedidoId,
        payer: {
          email: email || 'cliente@brunapresente.com',
          first_name: nome || 'Cliente'
        },
        notification_url: `${process.env.BACKEND_URL || 'http://localhost:3000'}/api/webhooks/mercadopago`
      };
      
      const result = await payment.create({ body: paymentData });
      
      console.log('✅ Pagamento PIX criado com sucesso:', result.id);
      
      // Extrair informações do PIX
      const pixData = result.point_of_interaction.transaction_data;
      
      // Atualizar pedido no Firebase
      const admin = require('firebase-admin');
      await db.collection('pedidos').doc(pedidoId).update({
        mercadoPagoPaymentId: result.id,
        mercadoPagoStatus: result.status,
        pixQrCode: pixData.qr_code,
        pixQrCodeBase64: pixData.qr_code_base64,
        dataAtualizacao: admin.firestore.FieldValue.serverTimestamp()
      });
      
      // Retornar dados do PIX
      res.json({
        success: true,
        paymentId: result.id,
        status: result.status,
        pix: {
          qrCode: pixData.qr_code,
          qrCodeBase64: pixData.qr_code_base64,
          qrCodeUrl: `data:image/png;base64,${pixData.qr_code_base64}`
        },
        expirationDate: result.date_of_expiration
      });
      
    } catch (error) {
      console.error('❌ Erro ao criar pagamento PIX:', error);
      res.status(500).json({
        error: true,
        message: error.message || 'Erro ao criar pagamento',
        details: error.cause || []
      });
    }
  });
  
  // Consultar pagamento
  router.get('/:paymentId', async (req, res) => {
    try {
      const { paymentId } = req.params;
      
      const result = await payment.get({ id: paymentId });
      
      res.json({
        success: true,
        payment: {
          id: result.id,
          status: result.status,
          statusDetail: result.status_detail,
          amount: result.transaction_amount,
          dateCreated: result.date_created,
          dateApproved: result.date_approved,
          externalReference: result.external_reference
        }
      });
      
    } catch (error) {
      console.error('❌ Erro ao consultar pagamento:', error);
      res.status(500).json({
        error: true,
        message: error.message
      });
    }
  });
  
  return router;
};