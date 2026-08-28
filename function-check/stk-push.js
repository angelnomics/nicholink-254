
const PUBLISHING_FEE = 250;
const MPESA_BASE_URL = "https://sandbox.safaricom.co.ke";

async function getAccessToken() {
    const credentials = Buffer.from(
        `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
    ).toString("base64");

    const response = await fetch(
        `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
        {
            headers: {
                Authorization: `Basic ${credentials}`
            }
        }
    );

    if (!response.ok) {
        throw new Error("Failed to obtain M-Pesa access token");
    }

    const data = await response.json();

    return data.access_token;
}

function getTimestamp() {
    const now = new Date();

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");

    return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

function normalizePhone(phone) {
    let number = String(phone).replace(/\D/g, "");

    if (number.startsWith("07") || number.startsWith("01")) {
        number = "254" + number.substring(1);
    }

    return number;
}

exports.handler = async (event) => {
    try {
        /*
         * M-Pesa callback
         */
        if (event.httpMethod === "POST") {
            const callback = JSON.parse(event.body || "{}");

            console.log(
                "M-Pesa callback:",
                JSON.stringify(callback)
            );

            return {
                statusCode: 200,
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    ResultCode: 0,
                    ResultDesc: "Accepted"
                })
            };
        }

        /*
         * STK Push request
         */
        if (event.httpMethod !== "GET") {
            return {
                statusCode: 405,
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    success: false,
                    message: "Method not allowed"
                })
            };
        }

        const phone = event.queryStringParameters?.phone;
        const propertyId = event.queryStringParameters?.property_id;

        if (!phone || !propertyId) {
            return {
                statusCode: 400,
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    success: false,
                    message: "Phone number and property ID are required"
                })
            };
        }

        const phoneNumber = normalizePhone(phone);

        if (!/^254\d{9}$/.test(phoneNumber)) {
            return {
                statusCode: 400,
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    success: false,
                    message: "Invalid Kenyan phone number"
                })
            };
        }

        const timestamp = getTimestamp();

        const password = Buffer.from(
            `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
        ).toString("base64");

        const accessToken = await getAccessToken();

        const callbackUrl =
            "https://nicholink254.netlify.app/.netlify/functions/stk-push";

        const mpesaResponse = await fetch(
            `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    BusinessShortCode: process.env.MPESA_SHORTCODE,
                    Password: password,
                    Timestamp: timestamp,
                    TransactionType: "CustomerPayBillOnline",
                    Amount: PUBLISHING_FEE,
                    PartyA: phoneNumber,
                    PartyB: process.env.MPESA_SHORTCODE,
                    PhoneNumber: phoneNumber,
                    CallBackURL: callbackUrl,
                    AccountReference: `NichoLink-${propertyId.substring(0, 8)}`,
                    TransactionDesc: "NichoLink Property Publishing"
                })
            }
        );

        const result = await mpesaResponse.json();

        console.log(
            "M-Pesa response:",
            JSON.stringify(result)
        );

        if (!mpesaResponse.ok) {
            return {
                statusCode: 500,
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    success: false,
                    message: "M-Pesa request failed",
                    error: result
                })
            };
        }

        return {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                success: true,
                amount: PUBLISHING_FEE,
                checkout_request_id: result.CheckoutRequestID,
                merchant_request_id: result.MerchantRequestID,
                response_description: result.ResponseDescription
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
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                success: false,
                message: "Unable to start M-Pesa payment"
            })
        };
    }
};