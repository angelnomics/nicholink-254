/* =================================
   NICHO LINK 254
   ADMIN AUTHENTICATION
================================= */

async function requireAdmin() {

    try {

        const {
            data: {
                user
            },
            error: sessionError
        } = await supabaseClient.auth.getUser();


        if (sessionError) {
            throw sessionError;
        }


        /* No logged-in user */

        if (!user) {

            window.location.href =
                "login.html";

            return false;
        }


        /* Get account information */

        const {
            data: profile,
            error: profileError
        } = await supabaseClient

            .from("profiles")

            .select(`
                id,
                full_name,
                email,
                account_type,
                is_active
            `)

            .eq(
                "id",
                user.id
            )

            .single();


        if (profileError) {
            throw profileError;
        }


        /* Check account type */

        const accountType =
            String(
                profile.account_type || ""
            )
            .trim()
            .toLowerCase();


        /* Not an admin */

        if (accountType !== "admin") {

            alert(
                "Access denied. Admin access only."
            );

            window.location.href =
                "index.html";

            return false;
        }


        /* Check account status */

        if (
            profile.is_active === false
        ) {

            alert(
                "Your account is inactive."
            );

            await supabaseClient.auth.signOut();

            window.location.href =
                "login.html";

            return false;
        }


        /* Admin verified */

        console.log(
            "Admin authenticated:",
            profile.full_name
        );

        return true;

    }

    catch (error) {

        console.error(
            "Admin authentication error:",
            error
        );

        alert(
            "Unable to verify administrator access."
        );

        window.location.href =
            "login.html";

        return false;
    }

}