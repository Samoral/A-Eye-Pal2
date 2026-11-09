export interface PayPalOrderResult {
  orderId: string;
  status: 'CREATED' | 'SAVED' | 'APPROVED' | 'VOIDED' | 'COMPLETED' | 'PAYER_ACTION_REQUIRED';
  approveUrl: string;
  isDemoMode: boolean;
  currency: string;
  amount: number;
  recipient: string;
  purpose: string;
}

export interface PayPalCaptureResult {
  orderId: string;
  captureId: string;
  status: 'COMPLETED' | 'FAILED' | 'PENDING';
  isDemoMode: boolean;
  amount: number;
  currency: string;
  verifiedAt: string;
}

import { activityLogger } from './activityLogger.js';

export class PayPalService {
  private static clientId = process.env.PAYPAL_CLIENT_ID || '';
  private static clientSecret = process.env.PAYPAL_CLIENT_SECRET || '';
  private static isConfigured = Boolean(
    process.env.PAYPAL_CLIENT_ID &&
    process.env.PAYPAL_CLIENT_SECRET &&
    process.env.PAYPAL_CLIENT_ID !== 'MY_PAYPAL_CLIENT_ID'
  );

  private static baseUrl = 'https://api-m.sandbox.paypal.com';

  /**
   * Check whether live PayPal Sandbox credentials are configured
   */
  static getStatus(): { isLiveSandbox: boolean; environment: string; note: string } {
    return {
      isLiveSandbox: this.isConfigured,
      environment: this.isConfigured ? 'PayPal Sandbox (Live Sandbox REST v2)' : 'PayPal Sandbox (Demo Simulation Mode)',
      note: this.isConfigured
        ? 'Connected to PayPal Sandbox API endpoint https://api-m.sandbox.paypal.com'
        : 'Running in clearly labelled PayPal Sandbox demo simulation. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in Secrets for direct Sandbox credentials.',
    };
  }

  /**
   * Acquire OAuth2 access token from PayPal Sandbox
   */
  private static async getAccessToken(): Promise<string> {
    if (!this.isConfigured) {
      throw new Error('PayPal Sandbox credentials not configured');
    }

    const startTime = Date.now();
    activityLogger.emit({
      stage: 'PAYPAL_SANDBOX',
      service: 'PAYPAL_SANDBOX',
      eventType: 'OAUTH_TOKEN_REQUESTED',
      message: 'Requesting OAuth2 client token from PayPal Sandbox endpoint.',
      status: 'processing',
      sanitizedMetadata: { endpoint: '/v1/oauth2/token' },
    });

    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    const duration = Date.now() - startTime;

    if (!response.ok) {
      const errText = await response.text();
      activityLogger.emit({
        stage: 'PAYPAL_SANDBOX',
        service: 'PAYPAL_SANDBOX',
        eventType: 'OAUTH_TOKEN_FAILED',
        message: `PayPal OAuth token request failed with status ${response.status}.`,
        status: 'failed',
        duration,
      });
      throw new Error(`PayPal OAuth failed: ${response.status} - ${errText}`);
    }

    activityLogger.emit({
      stage: 'PAYPAL_SANDBOX',
      service: 'PAYPAL_SANDBOX',
      eventType: 'OAUTH_TOKEN_ACQUIRED',
      message: 'OAuth2 access token acquired successfully (token value withheld).',
      status: 'success',
      duration,
    });

    const data = await response.json();
    return data.access_token;
  }

  /**
   * Create an order via PayPal REST API v2
   */
  static async createOrder(params: {
    amount: number;
    currency: string;
    recipient: string;
    purpose: string;
    referenceId: string;
  }): Promise<PayPalOrderResult> {
    const formattedAmount = params.amount.toFixed(2);
    const currency = params.currency.toUpperCase();
    const startTime = Date.now();

    activityLogger.emit({
      stage: 'PAYPAL_SANDBOX',
      service: 'PAYPAL_SANDBOX',
      eventType: 'CREATE_ORDER_SENT',
      message: `Sending create order request to PayPal Sandbox for $${formattedAmount} ${currency}.`,
      status: 'processing',
      sanitizedMetadata: {
        operation: 'POST /v2/checkout/orders',
        recipient: params.recipient,
        amount: params.amount,
        currency,
      },
    });

    // If configured with real Sandbox credentials, invoke Sandbox REST v2
    if (this.isConfigured) {
      try {
        const accessToken = await this.getAccessToken();
        const payload = {
          intent: 'CAPTURE',
          purchase_units: [
            {
              reference_id: params.referenceId,
              description: `Payment to ${params.recipient}: ${params.purpose}`,
              custom_id: params.referenceId,
              amount: {
                currency_code: currency,
                value: formattedAmount,
              },
            },
          ],
          application_context: {
            brand_name: 'A-Eye Pal Accessible Financial Assistant',
            landing_page: 'NO_PREFERENCE',
            user_action: 'PAY_NOW',
            return_url: `${process.env.APP_URL || 'http://localhost:3000'}/api/paypal/return`,
            cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/api/paypal/cancel`,
          },
        };

        const res = await fetch(`${this.baseUrl}/v2/checkout/orders`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'PayPal-Request-Id': `req-${params.referenceId}-${Date.now()}`,
          },
          body: JSON.stringify(payload),
        });

        const duration = Date.now() - startTime;

        if (res.ok) {
          const order = await res.json();
          const approveLink = order.links?.find((l: { rel: string; href: string }) => l.rel === 'approve')?.href || '';

          activityLogger.emit({
            stage: 'PAYPAL_SANDBOX',
            service: 'PAYPAL_SANDBOX',
            eventType: 'ORDER_CREATED_SUCCESS',
            message: `PayPal Sandbox live order created with ID: ${order.id}. Status: ${order.status}.`,
            status: 'success',
            duration,
            sanitizedMetadata: {
              orderId: order.id,
              orderStatus: order.status,
              isLiveSandbox: true,
            },
          });

          return {
            orderId: order.id,
            status: order.status,
            approveUrl: approveLink,
            isDemoMode: false,
            currency,
            amount: params.amount,
            recipient: params.recipient,
            purpose: params.purpose,
          };
        }

        const errText = await res.text();
        console.warn('PayPal Sandbox order creation failed, falling back to simulated sandbox:', errText);
        activityLogger.emit({
          stage: 'PAYPAL_SANDBOX',
          service: 'PAYPAL_SANDBOX',
          eventType: 'ORDER_CREATION_FAILED_FALLBACK',
          message: `Live PayPal order failed (HTTP ${res.status}). Falling back to Sandbox demo simulation.`,
          status: 'failed',
          duration,
        });
      } catch (err: any) {
        console.warn('PayPal Sandbox API request failed, falling back to clearly labelled demo mode:', err);
      }
    }

    // Clearly Labelled Demo Sandbox Mode
    const duration = Date.now() - startTime;
    const mockOrderId = `SANDBOX-ORD-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

    activityLogger.emit({
      stage: 'PAYPAL_SANDBOX',
      service: 'PAYPAL_SANDBOX',
      eventType: 'ORDER_CREATED_DEMO',
      message: `PayPal Sandbox demo order generated with ID: ${mockOrderId}. Mode: Demo Simulation.`,
      status: 'success',
      duration,
      sanitizedMetadata: {
        orderId: mockOrderId,
        orderStatus: 'CREATED',
        isLiveSandbox: false,
      },
    });

    return {
      orderId: mockOrderId,
      status: 'CREATED',
      approveUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${mockOrderId}`,
      isDemoMode: true,
      currency,
      amount: params.amount,
      recipient: params.recipient,
      purpose: params.purpose,
    };
  }

  /**
   * Capture an authorized order via PayPal REST API v2
   */
  static async captureOrder(orderId: string, amount: number, currency: string): Promise<PayPalCaptureResult> {
    const startTime = Date.now();

    activityLogger.emit({
      stage: 'PAYPAL_SANDBOX',
      service: 'PAYPAL_SANDBOX',
      eventType: 'CAPTURE_REQUEST_SENT',
      message: `Dispatching payment capture request for PayPal Order ID: ${orderId}.`,
      status: 'processing',
      sanitizedMetadata: {
        operation: 'POST /v2/checkout/orders/{id}/capture',
        orderId,
        amount,
        currency,
      },
    });

    if (this.isConfigured && !orderId.startsWith('SANDBOX-ORD-')) {
      try {
        const accessToken = await this.getAccessToken();
        const res = await fetch(`${this.baseUrl}/v2/checkout/orders/${orderId}/capture`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'PayPal-Request-Id': `cap-${orderId}-${Date.now()}`,
          },
        });

        const duration = Date.now() - startTime;

        if (res.ok) {
          const captureData = await res.json();
          const captureUnit = captureData.purchase_units?.[0]?.payments?.captures?.[0];
          const capId = captureUnit?.id || `CAP-${orderId}`;

          activityLogger.emit({
            stage: 'PAYPAL_SANDBOX',
            service: 'PAYPAL_SANDBOX',
            eventType: 'CAPTURE_SUCCESS',
            message: `PayPal Sandbox live payment captured successfully. Capture ID: ${capId}.`,
            status: 'success',
            duration,
            sanitizedMetadata: {
              orderId,
              captureId: capId,
              status: 'COMPLETED',
            },
          });

          return {
            orderId,
            captureId: capId,
            status: 'COMPLETED',
            isDemoMode: false,
            amount,
            currency,
            verifiedAt: new Date().toISOString(),
          };
        }

        console.warn('PayPal live sandbox capture failed:', await res.text());
        activityLogger.emit({
          stage: 'PAYPAL_SANDBOX',
          service: 'PAYPAL_SANDBOX',
          eventType: 'CAPTURE_FAILED',
          message: `Live capture call returned HTTP ${res.status}. Falling back to demo verification.`,
          status: 'failed',
          duration,
        });
      } catch (err: any) {
        console.warn('PayPal live sandbox capture error:', err);
      }
    }

    // Demo Mode Sandbox Capture
    const duration = Date.now() - startTime;
    const mockCaptureId = `SANDBOX-CAP-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

    activityLogger.emit({
      stage: 'PAYPAL_SANDBOX',
      service: 'PAYPAL_SANDBOX',
      eventType: 'CAPTURE_COMPLETED_DEMO',
      message: `PayPal Sandbox demo payment captured. Capture ID: ${mockCaptureId}. Status: COMPLETED.`,
      status: 'success',
      duration,
      sanitizedMetadata: {
        orderId,
        captureId: mockCaptureId,
        status: 'COMPLETED',
      },
    });

    return {
      orderId,
      captureId: mockCaptureId,
      status: 'COMPLETED',
      isDemoMode: true,
      amount,
      currency,
      verifiedAt: new Date().toISOString(),
    };
  }
}
