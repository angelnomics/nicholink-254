const PROPERTY_PUBLISHING_FEE = 250;
const VIDEO_ADVERT_FEE = 50;
const PHOTO_ADVERT_FEE = 25;

const MPESA_BASE_URL =
    "https://sandbox.safaricom.co.ke";

const SUPABASE_URL =
    process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY;


/* =====================================================
   M-PESA ACCESS TOKEN
===================================================== */

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


/* =====================================================
   TIMESTAMP
===================================================== */

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


/* =====================================================
   PHONE NORMALIZATION
===================================================== */

function normalizePhone(phone) {

    let number =
        String(phone)
            .replace(/\D/g, "");


    if (
        number.startsWith("07") ||
        number.startsWith("01")
    ) {

        number =
            "254" +
            number.substring(1);

    }


    if (
        number.startsWith("+254")
    ) {

        number =
            number.substring(1);

    }


    return number;

}


/* =====================================================
   SUPABASE REQUEST
===================================================== */

async function supabaseRequest(
    endpoint,
    options = {}
) {

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

        data =
            text;

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


/* =====================================================
   DETERMINE PAYMENT
===================================================== */

function getPaymentDetails(request) {

    const advertType =
        request.advert_type || null;


    const propertyId =
        request.property_id || null;


    let amount;

    let paymentType;

    let description;


    if (
        advertType === "video"
    ) {

        amount =
            VIDEO_ADVERT_FEE;

        paymentType =
            "video_advert";

        description =
            "NichoLink Video Advert";

    }

    else if (
        advertType === "photo"
    ) {

        amount =
            PHOTO_ADVERT_FEE;

        paymentType =
            "photo_advert";

        description =
            "NichoLink Photo Advert";

    }

    else {

        amount =
            PROPERTY_PUBLISHING_FEE;

        paymentType = "property_listing";

        description =
            "NichoLink Property Publishing";

    }


    return {
        amount,
        paymentType,
        description,
        propertyId
    };

}


/* =====================================================
   CREATE PAYMENT RECORD
===================================================== */

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
                        data.userId || null,

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


/* =====================================================
   UPDATE PAYMENT AFTER CALLBACK
===================================================== */

async function updatePaymentFromCallback(callback) {

    const checkoutRequestId =
        callback.CheckoutRequestID;

    const resultCode =
        callback.ResultCode;

    const resultDescription =
        callback.ResultDesc;

    let receiptNumber = null;
    let transactionDate = null;


    /* =================================================
       READ CALLBACK METADATA
    ================================================= */

    if (
        Array.isArray(
            callback.CallbackMetadata?.Item
        )
    ) {

        const items =
            callback.CallbackMetadata.Item;


        const receiptItem =
            items.find(
                item =>
                    item.Name ===
                    "MpesaReceiptNumber"
            );


        const dateItem =
            items.find(
                item =>
                    item.Name ===
                    "TransactionDate"
            );


        if (receiptItem) {

            receiptNumber =
                receiptItem.Value;

        }


        if (dateItem) {

            transactionDate =
                dateItem.Value;

        }

    }


    /* =================================================
       DETERMINE PAYMENT STATUS
    ================================================= */

    const successful =
        Number(resultCode) === 0;


    const status =
        successful
            ? "success"
            : "failed";


    /* =================================================
       FIND PAYMENT RECORD
    ================================================= */

    const payments =
        await supabaseRequest(
            `payments?checkout_request_id=eq.${encodeURIComponent(
                checkoutRequestId
            )}&select=*`,
            {
                method:
                    "GET"
            }
        );


    const payment =
        Array.isArray(payments) &&
        payments.length > 0
            ? payments[0]
            : null;


    if (!payment) {

        console.error(
            "Payment record not found:",
            checkoutRequestId
        );

        return;

    }


    /* =================================================
       UPDATE PAYMENT
    ================================================= */

    await supabaseRequest(

        `payments?checkout_request_id=eq.${encodeURIComponent(
            checkoutRequestId
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

                    mpesa_receipt_number:
                        receiptNumber
                            ? String(receiptNumber)
                            : null,

                    transaction_date:
                        transactionDate
                            ? String(transactionDate)
                            : null,

                    result_code:
                        Number(resultCode),

                    result_description:
                        resultDescription,

                    status:
                        status,

                    updated_at:
                        new Date().toISOString()

                })

        }

    );


    console.log(
        "Payment updated:",
        checkoutRequestId,
        status
    );


    /* =================================================
       STOP IF PAYMENT FAILED
    ================================================= */

    if (!successful) {

        console.log(
            "Payment failed. Nothing will be published."
        );

        return;

    }


    /* =================================================
       PROPERTY PAYMENT
    ================================================= */

    if (
        payment.payment_type ===
        "property_listing"
    ) {

        const propertyId =
            payment.property_id;


        if (!propertyId) {

            console.error(
                "Successful property payment has no property_id."
            );

            return;

        }


        /* =============================================
           PUBLISH PROPERTY
        ============================================= */

        await supabaseRequest(

            `properties?id=eq.${encodeURIComponent(
                propertyId
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


        console.log(
            "Property published after successful payment:",
            propertyId
        );

    }


    /* =================================================
       VIDEO / PHOTO ADVERT
    ================================================= */

    if (
        payment.payment_type ===
        "video_advert" ||
        payment.payment_type ===
        "photo_advert"
    ) {

        console.log(
            "Advert payment confirmed:",
            payment.payment_type
        );

        /*
           Advert publication will be connected
           when the adverts tables are finalized.
        */

    }

}