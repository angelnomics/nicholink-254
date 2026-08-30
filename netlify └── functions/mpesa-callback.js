// =====================================================
// NICHOlink 254 — M-PESA CALLBACK
// =====================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY;


// =====================================================
// RATE LIMITING
// =====================================================

const requests = new Map();

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 30;

function isRateLimited(ip) {
    const now = Date.now();
    const record = requests.get(ip);

    if (!record || now - record.start > WINDOW_MS) {
        requests.set(ip, {
            count: 1,
            start: now
        });

        return false;
    }

    record.count++;

    return record.count > MAX_REQUESTS;
}


// =====================================================
// RESPONSE
// =====================================================

function response(statusCode, body) {
    return {
        statusCode,

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify(body)
    };
}


// =====================================================
// SUPABASE REQUEST
// =====================================================

async function supabaseRequest(endpoint, options = {}) {

    const result = await fetch(
        `${SUPABASE_URL}/rest/v1/${endpoint}`,
        {
            ...options,

            headers: {
                "Content-Type": "application/json",

                "apikey":
                    SUPABASE_SERVICE_ROLE_KEY,

                "Authorization":
                    `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

                ...(options.headers || {})
            }
        }
    );

    const text = await result.text();

    let data = null;

    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = text;
    }

    if (!result.ok) {

        console.error(
            "Supabase request failed:",
            data
        );

        throw new Error(
            "Supabase request failed."
        );
    }

    return data;
}


// =====================================================
// GET CLIENT IP
// =====================================================

function getClientIp(event) {

    const headers =
        event.headers || {};

    return (
        headers["x-nf-client-connection-ip"] ||
        headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        headers["client-ip"] ||
        "unknown"
    );
}


// =====================================================
// M-PESA CALLBACK
// =====================================================

exports.handler = async function(event) {

    try {

        // -------------------------------------------------
        // ONLY POST REQUESTS
        // -------------------------------------------------

        if (event.httpMethod !== "POST") {

            return response(
                405,
                {
                    success: false,
                    message: "Method not allowed"
                }
            );
        }


        // -------------------------------------------------
        // RATE LIMIT
        // -------------------------------------------------

        const ip =
            getClientIp(event);

        if (isRateLimited(ip)) {

            console.warn(
                "M-Pesa callback rate limit exceeded:",
                ip
            );

            return response(
                429,
                {
                    ResultCode: 1,
                    ResultDesc:
                        "Too many requests."
                }
            );
        }


        // -------------------------------------------------
        // PARSE CALLBACK
        // -------------------------------------------------

        const callback =
            JSON.parse(
                event.body || "{}"
            );


        const body =
            callback?.Body?.stkCallback;


        if (!body) {

            console.error(
                "Invalid M-Pesa callback structure."
            );

            return response(
                400,
                {
                    ResultCode: 1,
                    ResultDesc:
                        "Invalid callback."
                }
            );
        }


        // -------------------------------------------------
        // CALLBACK DETAILS
        // -------------------------------------------------

        const checkoutRequestId =
            body.CheckoutRequestID || null;

        const merchantRequestId =
            body.MerchantRequestID || null;

        const resultCode =
            body.ResultCode;

        const resultDescription =
            body.ResultDesc || null;


        if (!checkoutRequestId) {

            console.error(
                "Missing CheckoutRequestID."
            );

            return response(
                400,
                {
                    ResultCode: 1,
                    ResultDesc:
                        "Missing CheckoutRequestID."
                }
            );
        }


        // -------------------------------------------------
        // FIND PAYMENT
        // -------------------------------------------------

        const payments =
            await supabaseRequest(

                `payments?checkout_request_id=eq.${encodeURIComponent(
                    checkoutRequestId
                )}&select=*`

            );


        if (
            !Array.isArray(payments) ||
            payments.length === 0
        ) {

            console.warn(
                "Payment not found:",
                checkoutRequestId
            );

            /*
             * We still acknowledge the callback so
             * Safaricom does not repeatedly resend it.
             */

            return response(
                200,
                {
                    ResultCode: 0,
                    ResultDesc:
                        "Accepted"
                }
            );
        }


        const payment =
            payments[0];


        // -------------------------------------------------
        // PREVENT DUPLICATE PROCESSING
        // -------------------------------------------------

        if (
            payment.status === "success"
        ) {

            console.log(
                "Payment already processed:",
                checkoutRequestId
            );

            return response(
                200,
                {
                    ResultCode: 0,
                    ResultDesc:
                        "Already processed"
                }
            );
        }


        // -------------------------------------------------
        // EXTRACT M-PESA RECEIPT
        // -------------------------------------------------

        let mpesaReceiptNumber =
            null;

        let transactionDate =
            null;


        const metadata =
            body.CallbackMetadata?.Item || [];


        for (const item of metadata) {

            if (
                item.Name ===
                "MpesaReceiptNumber"
            ) {

                mpesaReceiptNumber =
                    item.Value || null;
            }


            if (
                item.Name ===
                "TransactionDate"
            ) {

                transactionDate =
                    String(
                        item.Value
                    );
            }
        }


        // -------------------------------------------------
        // PAYMENT SUCCESS
        // -------------------------------------------------

        if (Number(resultCode) === 0) {

            await supabaseRequest(

                `payments?id=eq.${encodeURIComponent(
                    payment.id
                )}`,

                {

                    method:
                        "PATCH",

                    headers: {

                        "Prefer":
                            "return=minimal"
                    },

                    body:
                        JSON.stringify({

                            status:
                                "success",

                            mpesa_receipt_number:
                                mpesaReceiptNumber,

                            transaction_date:
                                transactionDate,

                            result_code:
                                resultCode,

                            result_description:
                                resultDescription,

                            updated_at:
                                new Date().toISOString()

                        })
                }

            );


            // -------------------------------------------------
            // PUBLISH PROPERTY AFTER SUCCESSFUL PAYMENT
            // -------------------------------------------------

            if (
                payment.property_id &&
                payment.payment_type ===
                    "property_listing"
            ) {

                await supabaseRequest(

                    `properties?id=eq.${encodeURIComponent(
                        payment.property_id
                    )}`,

                    {

                        method:
                            "PATCH",

                        headers: {

                            "Prefer":
                                "return=minimal"
                        },

                        body:
                            JSON.stringify({

                                is_published:
                                    true,

                                updated_at:
                                    new Date().toISOString()

                            })
                    }

                );

            }


            console.log(
                "Payment successfully processed:",
                checkoutRequestId
            );

        }


        // -------------------------------------------------
        // PAYMENT FAILED
        // -------------------------------------------------

        else {

            await supabaseRequest(

                `payments?id=eq.${encodeURIComponent(
                    payment.id
                )}`,

                {

                    method:
                        "PATCH",

                    headers: {

                        "Prefer":
                            "return=minimal"
                    },

                    body:
                        JSON.stringify({

                            status:
                                "failed",

                            result_code:
                                resultCode,

                            result_description:
                                resultDescription,

                            updated_at:
                                new Date().toISOString()

                        })
                }

            );


            console.log(
                "Payment failed:",
                checkoutRequestId,
                resultDescription
            );
        }


        // -------------------------------------------------
        // ACKNOWLEDGE SAFARICOM
        // -------------------------------------------------

        return response(
            200,
            {
                ResultCode: 0,
                ResultDesc: "Accepted"
            }
        );


    } catch (error) {

        console.error(
            "M-Pesa callback error:",
            error
        );


        /*
         * Return 200 to Safaricom so the callback is
         * acknowledged. The error is recorded in logs.
         */

        return response(
            200,
            {
                ResultCode: 0,
                ResultDesc: "Accepted"
            }
        );
    }
};