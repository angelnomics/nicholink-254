// =====================================================
// NICHOLINK 254 — M-PESA STK PUSH
// =====================================================

const PROPERTY_PUBLISHING_FEE = 250;
const VIDEO_ADVERT_FEE = 50;
const PHOTO_ADVERT_FEE = 25;

const MPESA_BASE_URL =
    "https://sandbox.safaricom.co.ke";

const SUPABASE_URL =
    process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY;


// =====================================================
// RATE LIMIT SETTINGS
// =====================================================

const USER_LIMIT = 5;
const PHONE_LIMIT = 3;
const IP_LIMIT = 5;

const RATE_WINDOW_MINUTES = 10;


// =====================================================
// RESPONSE
// =====================================================

function response(statusCode, body) {

    return {

        statusCode,

        headers: {

            "Content-Type":
                "application/json",

            "Access-Control-Allow-Origin":
                "https://nicholink254.netlify.app",

            "Access-Control-Allow-Headers":
                "Content-Type, Authorization, apikey",

            "Access-Control-Allow-Methods":
                "POST, OPTIONS"

        },

        body:
            JSON.stringify(body)

    };
}


// =====================================================
// SUPABASE REQUEST
// =====================================================

async function supabaseRequest(
    endpoint,
    options = {}
) {

    const result =
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
        await result.text();


    let data = null;


    try {

        data =
            text
                ? JSON.parse(text)
                : null;

    } catch {

        data = text;

    }


    if (!result.ok) {

        console.error(
            "Supabase error:",
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

        headers["x-forwarded-for"]
            ?.split(",")[0]
            ?.trim() ||

        headers["client-ip"] ||

        "unknown"

    );
}


// =====================================================
// AUTHENTICATED USER
// =====================================================

async function getAuthenticatedUser(event) {

    const authorization =
        event.headers?.authorization ||
        event.headers?.Authorization;


    if (
        !authorization ||
        !authorization.startsWith("Bearer ")
    ) {

        return null;
    }


    const accessToken =
        authorization.substring(7);


    const result =
        await fetch(
            `${SUPABASE_URL}/auth/v1/user`,
            {

                method:
                    "GET",

                headers: {

                    "apikey":
                        SUPABASE_SERVICE_ROLE_KEY,

                    "Authorization":
                        `Bearer ${accessToken}`

                }

            }
        );


    if (!result.ok) {

        return null;
    }


    return await result.json();
}


// =====================================================
// NORMALIZE PHONE
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
// VALIDATE PHONE
// =====================================================

function validatePhone(phone) {

    return /^2547\d{8}$/.test(phone);
}


// =====================================================
// RATE LIMIT CHECK
// =====================================================

async function checkRateLimit({
    userId,
    phoneNumber,
    ipAddress
}) {

    const windowStart =
        new Date(
            Date.now() -
            RATE_WINDOW_MINUTES *
            60 *
            1000
        ).toISOString();


    // -------------------------------------------------
    // USER LIMIT
    // -------------------------------------------------

    if (userId) {

        const requests =
            await supabaseRequest(

                `mpesa_rate_limits?user_id=eq.${encodeURIComponent(
                    userId
                )}&request_type=eq.stk_push&created_at=gte.${encodeURIComponent(
                    windowStart
                )}&select=id`

            );


        if (
            Array.isArray(requests) &&
            requests.length >= USER_LIMIT
        ) {

            return {

                allowed: false,

                message:
                    "Too many payment requests from this account. Please wait a few minutes."

            };
        }
    }


    // -------------------------------------------------
    // PHONE LIMIT
    // -------------------------------------------------

    if (phoneNumber) {

        const requests =
            await supabaseRequest(

                `mpesa_rate_limits?phone_number=eq.${encodeURIComponent(
                    phoneNumber
                )}&request_type=eq.stk_push&created_at=gte.${encodeURIComponent(
                    windowStart
                )}&select=id`

            );


        if (
            Array.isArray(requests) &&
            requests.length >= PHONE_LIMIT
        ) {

            return {

                allowed: false,

                message:
                    "Too many M-Pesa requests for this phone number. Please wait a few minutes."

            };
        }
    }


    // -------------------------------------------------
    // IP LIMIT
    // -------------------------------------------------

    if (
        ipAddress &&
        ipAddress !== "unknown"
    ) {

        const requests =
            await supabaseRequest(

                `mpesa_rate_limits?ip_address=eq.${encodeURIComponent(
                    ipAddress
                )}&request_type=eq.stk_push&created_at=gte.${encodeURIComponent(
                    windowStart
                )}&select=id`

            );


        if (
            Array.isArray(requests) &&
            requests.length >= IP_LIMIT
        ) {

            return {

                allowed: false,

                message:
                    "Too many payment requests from this connection. Please wait a few minutes."

            };
        }
    }


    return {

        allowed: true

    };
}


// =====================================================
// RECORD RATE LIMIT REQUEST
// =====================================================

async function recordRateLimit({
    userId,
    phoneNumber,
    ipAddress
}) {

    await supabaseRequest(

        "mpesa_rate_limits",

        {

            method:
                "POST",

            headers: {

                "Prefer":
                    "return=minimal"

            },

            body:
                JSON.stringify({

                    user_id:
                        userId || null,

                    phone_number:
                        phoneNumber || null,

                    ip_address:
                        ipAddress || null,

                    request_type:
                        "stk_push"

                })

        }

    );
}


// =====================================================
// GET PAYMENT DETAILS
// =====================================================

function getPaymentDetails(request) {

    const advertType =
        request.advert_type || null;

    const propertyId =
        request.property_id || null;


    if (
        advertType === "video"
    ) {

        return {

            amount:
                VIDEO_ADVERT_FEE,

            paymentType:
                "video_advert",

            description:
                "NichoLink Video Advert",

            propertyId

        };
    }


    if (
        advertType === "photo"
    ) {

        return {

            amount:
                PHOTO_ADVERT_FEE,

            paymentType:
                "photo_advert",

            description:
                "NichoLink Photo Advert",

            propertyId

        };
    }


    return {

        amount:
            PROPERTY_PUBLISHING_FEE,

        paymentType:
            "property_listing",

        description:
            "NichoLink Property Publishing",

        propertyId

    };
}


// =====================================================
// VERIFY PROPERTY OWNERSHIP
// =====================================================

async function verifyPropertyOwnership(
    propertyId,
    userId
) {

    if (!propertyId) {

        return false;
    }


    const properties =
        await supabaseRequest(

            `properties?id=eq.${encodeURIComponent(
                propertyId
            )}&landlord_id=eq.${encodeURIComponent(
                userId
            )}&select=id,landlord_id,is_published&limit=1`

        );


    return (
        Array.isArray(properties) &&
        properties.length > 0
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


    const result =
        await fetch(

            `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,

            {

                headers: {

                    Authorization:
                        `Basic ${credentials}`

                }

            }

        );


    if (!result.ok) {

        throw new Error(
            "Failed to obtain M-Pesa access token."
        );
    }


    const data =
        await result.json();


    if (!data.access_token) {

        throw new Error(
            "M-Pesa access token was not returned."
        );
    }


    return data.access_token;
}


// =====================================================
// TIMESTAMP
// =====================================================

function getTimestamp() {

    const now =
        new Date();


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
// START STK PUSH
// =====================================================

async function startStkPush({

    accessToken,
    phoneNumber,
    amount,
    description

}) {

    const timestamp =
        getTimestamp();


    const shortcode =
        process.env.MPESA_SHORTCODE;


    const passkey =
        process.env.MPESA_PASSKEY;


    const password =
        Buffer.from(

            `${shortcode}${passkey}${timestamp}`

        ).toString("base64");


    const result =
        await fetch(

            `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,

            {

                method:
                    "POST",

                headers: {

                    Authorization:
                        `Bearer ${accessToken}`,

                    "Content-Type":
                        "application/json"

                },

                body:
                    JSON.stringify({

                        BusinessShortCode:
                            shortcode,

                        Password:
                            password,

                        Timestamp:
                            timestamp,

                        TransactionType:
                            "CustomerPayBillOnline",

                        Amount:
                            amount,

                        PartyA:
                            phoneNumber,

                        PartyB:
                            shortcode,

                        PhoneNumber:
                            phoneNumber,

                        CallBackURL:
                            process.env.MPESA_CALLBACK_URL,

                        AccountReference:
                            "NichoLink254",

                        TransactionDesc:
                            description

                    })

            }

        );


    const data =
        await result.json();


    if (!result.ok) {

        console.error(
            "M-Pesa STK error:",
            data
        );

        throw new Error(

            data.errorMessage ||

            data.ResponseDescription ||

            "M-Pesa payment request failed."

        );
    }


    if (
        data.ResponseCode !== "0"
    ) {

        throw new Error(

            data.ResponseDescription ||

            "M-Pesa payment request was rejected."

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

            method:
                "POST",

            headers: {

                "Prefer":
                    "return=representation"

            },

            body:
                JSON.stringify({

                    user_id:
                        data.userId,

                    payment_type:
                        data.paymentType,

                    amount:
                        data.amount,

                    phone_number:
                        data.phoneNumber,

                    merchant_request_id:
                        data.merchantRequestId,

                    checkout_request_id:
                        data.checkoutRequestId,

                    status:
                        "pending",

                    property_id:
                        data.propertyId || null

                })

        }

    );
}


// =====================================================
// MAIN HANDLER
// =====================================================

exports.handler =
async function(event) {

    try {

        // -------------------------------------------------
        // CORS PREFLIGHT
        // -------------------------------------------------

        if (
            event.httpMethod ===
            "OPTIONS"
        ) {

            return response(
                204,
                {}
            );
        }


        // -------------------------------------------------
        // ONLY POST
        // -------------------------------------------------

        if (
            event.httpMethod !==
            "POST"
        ) {

            return response(
                405,
                {
                    success: false,
                    message:
                        "Method not allowed."
                }
            );
        }


        // -------------------------------------------------
        // AUTHENTICATION
        // -------------------------------------------------

        const user =
            await getAuthenticatedUser(event);


        if (!user || !user.id) {

            return response(
                401,
                {
                    success: false,
                    message:
                        "Authentication required."
                }
            );
        }


        const userId =
            user.id;


        // -------------------------------------------------
        // PARSE REQUEST
        // -------------------------------------------------

        let request;

        try {

            request =
                JSON.parse(
                    event.body || "{}"
                );

        } catch {

            return response(
                400,
                {
                    success: false,
                    message:
                        "Invalid request."
                }
            );
        }


        // -------------------------------------------------
        // PHONE
        // -------------------------------------------------

        const phoneNumber =
            normalizePhone(
                request.phone
            );


        if (
            !validatePhone(
                phoneNumber
            )
        ) {

            return response(
                400,
                {
                    success: false,
                    message:
                        "Enter a valid Kenyan Safaricom phone number."
                }
            );
        }


        // -------------------------------------------------
        // PAYMENT DETAILS
        // -------------------------------------------------

        const payment =
            getPaymentDetails(
                request
            );


        // -------------------------------------------------
        // PROPERTY OWNERSHIP
        // -------------------------------------------------

        if (
            payment.paymentType ===
                "property_listing" ||

            payment.paymentType ===
                "video_advert" ||

            payment.paymentType ===
                "photo_advert"
        ) {

            if (
                !payment.propertyId
            ) {

                return response(
                    400,
                    {
                        success: false,
                        message:
                            "Property ID is required."
                    }
                );
            }


            const ownsProperty =
                await verifyPropertyOwnership(
                    payment.propertyId,
                    userId
                );


            if (!ownsProperty) {

                return response(
                    403,
                    {
                        success: false,
                        message:
                            "You are not authorized to make a payment for this property."
                    }
                );
            }

        }


        // -------------------------------------------------
        // RATE LIMIT
        // -------------------------------------------------

        const ipAddress =
            getClientIp(event);


        const rateLimit =
            await checkRateLimit({

                userId,

                phoneNumber,

                ipAddress

            });


        if (!rateLimit.allowed) {

            return response(
                429,
                {
                    success: false,
                    message:
                        rateLimit.message
                }
            );
        }


        // Record only after authorization
        // and rate-limit validation.

        await recordRateLimit({

            userId,

            phoneNumber,

            ipAddress

        });


        // -------------------------------------------------
        // M-PESA
        // -------------------------------------------------

        const accessToken =
            await getAccessToken();


        const stk =
            await startStkPush({

                accessToken,

                phoneNumber,

                amount:
                    payment.amount,

                description:
                    payment.description

            });


        // -------------------------------------------------
        // SAVE PAYMENT
        // -------------------------------------------------

        await createPaymentRecord({

            userId,

            paymentType:
                payment.paymentType,

            amount:
                payment.amount,

            phoneNumber,

            merchantRequestId:
                stk.MerchantRequestID,

            checkoutRequestId:
                stk.CheckoutRequestID,

            propertyId:
                payment.propertyId

        });


        // -------------------------------------------------
        // SUCCESS RESPONSE
        // -------------------------------------------------

        return response(
            200,
            {

                success: true,

                message:
                    "M-Pesa payment request sent.",

                checkout_request_id:
                    stk.CheckoutRequestID,

                merchant_request_id:
                    stk.MerchantRequestID

            }
        );


    } catch (error) {

        console.error(
            "STK Push error:",
            error
        );


        return response(
            500,
            {
                success: false,
                message:
                    "Unable to start M-Pesa payment. Please try again."
            }
        );
    }
};