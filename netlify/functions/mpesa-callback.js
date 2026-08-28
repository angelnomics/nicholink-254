exports.handler = async (event) => {
    try {
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

    } catch (error) {

        console.error(
            "Callback error:",
            error
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
};