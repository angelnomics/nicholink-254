```js
// =====================================================
// M-PESA STK PUSH
// RATE LIMITED + INPUT PROTECTION + PAYMENT RECORD
// =====================================================

const PUBLISHING_FEE = 250;

const MPESA_BASE_URL =
    "https://sandbox.safaricom.co.ke";

const SUPABASE_URL =
    process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY;


// =====================================================
// RATE LIMITING
// =====================================================

const requests = new Map();

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 5;


function isRateLimited(ip) {

    const now = Date.now();

    const record = requests.get(ip);

    if (
        !record ||
        now - record.start > WINDOW_MS
    ) {

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
// SUPABASE REQUEST
// =====================================================

async function supabaseRequest(
    endpoint,
    options = {}
) {

    if (
        !SUPABASE_URL ||
        !SUPABASE_SERVICE_ROLE_KEY
    ) {

        throw new Error(
            "Supabase environment variables are missing"
        );
    }


    const response =
        await fetch(
            `${SUPABASE_URL}/rest/v1/${endpoint}`,
            {

                ...options,

                headers: {

                    "Content-Type":
                        "application/json",

                    "apikey":
                        SUPABASE_SERVICE_ROLE_KEY,

                    "Authorization":
                        `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

                    ...(options.headers || {})

                }

            }
        );


    const text =
        await response.text();

    let data = null;


    try {

        data =
            text
                ? JSON.parse(text)
                : null;

    } catch {

        data = text;

    }


    if (!response.ok) {

        console.error(
            "Supabase error:",
            data
        );

        throw new Error(
            "Supabase request failed"
        );
    }


    return data;
}


// =====================================================
// CREATE PAYMENT RECORD
// =====================================================

async function createPaymentRecord(data) {

    return await supabaseRequest(
        "payments",
        {

            method: "POST",

            headers: {

                "Prefer":
                    "return=representation"

            },

            body:
                JSON.stringify({

                    payment_type:
                        "property_listing",

                    amount:
                        PUBLISHING_FEE,

                    phone_number:
                        data.phoneNumber,

                    merchant_request_id:
                        data.merchantRequestId,

                    checkout_request_id:
                        data.checkoutRequestId,

                    status:
                        "pending",

                    property_id:
                        data.propertyId

                })

        }
    );
}


// =====================================================
// M-PESA ACCESS TOKEN
// =====================================================

async function getAccessToken() {

    const credentials =
        Buffer.from(
            `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
        ).toString("base64");


    const response =
        await fetch(
            `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
            {

                headers: {

                    Authorization:
                        `Basic ${credentials}`

                }

            }
        );


    if (!response.ok) {

        throw new Error(
            "Failed to obtain M-Pesa access token"
        );
    }


    const data =
        await response.json();


    return data.access_token;
}


// =====================================================
// TIMESTAMP
// =====================================================

function getTimestamp() {

    const now = new Date();

    return (
        now.getFullYear().toString() +

        String(
            now.getMonth() + 1
        ).padStart(2, "0") +

        String(
            now.getDate()
        ).padStart(2, "0") +

        String(
            now.getHours()
        ).padStart(2, "0") +

        String(
            now.getMinutes()
        ).padStart(2, "0") +

        String(
            now.getSeconds()
        ).padStart(2, "0")
    );
}


// =====================================================
// PHONE NORMALIZATION
// =====================================================

function normalizePhone(phone) {

    let number =
        String(phone || "")
            .replace(/\D/g, "");


    if (
        number.startsWith("07") ||
        number.startsWith("01")
    ) {

        number =
            "254" +
            number.substring(1);
    }


    return number;
}


// =====================================================
// MAIN FUNCTION
// =====================================================

exports.handler = async (event) => {

    try {

        // -------------------------------------------------
        // METHOD CHECK
        // -------------------------------------------------

        if (event.httpMethod !== "GET") {

            return {

                statusCode: 405,

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    success: false,

                    message:
                        "Method not allowed"

                })

            };
        }


        // -------------------------------------------------
        // CLIENT IP
        // -------------------------------------------------

        const ip =
            event.headers?.["x-forwarded-for"] ||
            event.headers?.["X-Forwarded-For"] ||
            event.requestContext?.http?.sourceIp ||
            "unknown";


        // -------------------------------------------------
        // RATE LIMIT
        // -------------------------------------------------

        if (isRateLimited(ip)) {

            console.warn(
                "STK Push rate limit exceeded:",
                ip
            );


            return {

                statusCode: 429,

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    success: false,

                    message:
                        "Too many payment attempts. Please wait 10 minutes and try again."

                })

            };
        }


        // -------------------------------------------------
        // INPUT
        // -------------------------------------------------

        const phone =
            event.queryStringParameters?.phone;

        const propertyId =
            event.queryStringParameters?.property_id;


        if (!phone || !propertyId) {

            return {

                statusCode: 400,

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    success: false,

                    message:
                        "Phone number and property ID are required"

                })

            };
        }


        // -------------------------------------------------
        // PROPERTY ID VALIDATION
        // -------------------------------------------------

        if (
            typeof propertyId !== "string" ||
            propertyId.length > 100
        ) {

            return {

                statusCode: 400,

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    success: false,

                    message:
                        "Invalid property ID"

                })

            };
        }


        // -------------------------------------------------
        // PHONE
        // -------------------------------------------------

        const phoneNumber =
            normalizePhone(phone);


        if (
            !/^254\d{9}$/.test(
                phoneNumber
            )
        ) {

            return {

                statusCode: 400,

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    success: false,

                    message:
                        "Invalid Kenyan phone number"

                })

            };
        }


        // -------------------------------------------------
        // TIMESTAMP
        // -------------------------------------------------

        const timestamp =
            getTimestamp();


        // -------------------------------------------------
        // PASSWORD
        // -------------------------------------------------

        const password =
            Buffer.from(
                `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
            ).toString("base64");


        // -------------------------------------------------
        // ACCESS TOKEN
        // -------------------------------------------------

        const accessToken =
            await getAccessToken();


        // -------------------------------------------------
        // CALLBACK
        // -------------------------------------------------

        const callbackUrl =
            "https://nicholink254.netlify.app/.netlify/functions/mpesa-callback";


        // -------------------------------------------------
        // SEND STK PUSH
        // -------------------------------------------------

        const mpesaResponse =
            await fetch(
                `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
                {

                    method: "POST",

                    headers: {

                        Authorization:
                            `Bearer ${accessToken}`,

                        "Content-Type":
                            "application/json"

                    },

                    body:
                        JSON.stringify({

                            BusinessShortCode:
                                process.env.MPESA_SHORTCODE,

                            Password:
                                password,

                            Timestamp:
                                timestamp,

                            TransactionType:
                                "CustomerPayBillOnline",

                            Amount:
                                PUBLISHING_FEE,

                            PartyA:
                                phoneNumber,

                            PartyB:
                                process.env.MPESA_SHORTCODE,

                            PhoneNumber:
                                phoneNumber,

                            CallBackURL:
                                callbackUrl,

                            AccountReference:
                                `NichoLink-${propertyId.substring(0, 8)}`,

                            TransactionDesc:
                                "NichoLink Property Publishing"

                        })

                }
            );


        const result =
            await mpesaResponse.json();


        console.log(
            "M-Pesa response:",
            JSON.stringify(result)
        );


        // -------------------------------------------------
        // M-PESA ERROR
        // -------------------------------------------------

        if (
            !mpesaResponse.ok ||
            !result.CheckoutRequestID
        ) {

            return {

                statusCode: 500,

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    success: false,

                    message:
                        "M-Pesa request failed"

                })

            };
        }


        // -------------------------------------------------
        // SAVE PAYMENT AS PENDING
        // -------------------------------------------------

        await createPaymentRecord({

            phoneNumber:
                phoneNumber,

            merchantRequestId:
                result.MerchantRequestID,

            checkoutRequestId:
                result.CheckoutRequestID,

            propertyId:
                propertyId

        });


        // -------------------------------------------------
        // SUCCESS
        // -------------------------------------------------

        return {

            statusCode: 200,

            headers: {
                "Content-Type":
                    "application/json"
            },

            body: JSON.stringify({

                success: true,

                amount:
                    PUBLISHING_FEE,

                checkout_request_id:
                    result.CheckoutRequestID,

                merchant_request_id:
                    result.MerchantRequestID,

                response_description:
                    result.ResponseDescription

            })

        };


    } catch (error) {

        console.error(
            "STK Push error:",
            error
        );


        return {

            statusCode: 500,

            headers: {
                "Content-Type":
                    "application/json"
            },

            body: JSON.stringify({

                success: false,

                message:
                    "Unable to start M-Pesa payment"

            })

        };

    }

};
```
