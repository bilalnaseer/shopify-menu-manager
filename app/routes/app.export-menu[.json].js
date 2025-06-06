// app/routes/app.export-menu[.json].js
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

const GET_MENU_DETAILS_QUERY = `
  query getMenu($id: ID!) {
    menu(id: $id) {
      handle
      title
      items {
        title
        url
        type
        resourceId
        items {
          title
          url
          type
          resourceId
          items {
            title
            url
            type
            resourceId
          }
        }
      }
    }
  }
`;

function prepareMenuItemsForCreate(items) {
  if (!items || items.length === 0) return [];
  return items.map((item) => {
    const newItem = {
      title: item.title,
      url: item.url,
      type: item.type,
    };
    if (item.resourceId) {
      newItem.resourceId = item.resourceId;
    }
    if (item.items && item.items.length > 0) {
      newItem.items = prepareMenuItemsForCreate(item.items);
    }
    return newItem;
  });
}

export async function loader({ request }) {
  console.log("EXPORT DATA LOADER: Request received:", request.url);
  let admin;
  try {
    const authResult = await authenticate.admin(request);
    admin = authResult.admin; // Assuming admin is a property on the result of authenticate.admin
    if (!admin || typeof admin.graphql !== 'function') {
      console.error("EXPORT DATA LOADER: Admin context error. Admin object or graphql method is missing.");
      return json({ error: "Admin context error", details: "Admin object or graphql method is missing." }, { status: 500 });
    }
    console.log("EXPORT DATA LOADER: Auth OK.");
  } catch (error) {
    console.error("EXPORT DATA LOADER: Auth error:", error);
    if (error instanceof Response) throw error; // Re-throw if it's a redirect/auth response
    return json({ error: "Auth error", details: error.message }, { status: 500 });
  }

  const url = new URL(request.url);
  const menuId = url.searchParams.get("menuId");
  console.log("EXPORT DATA LOADER: menuId:", menuId);

  if (!menuId) {
    console.error("EXPORT DATA LOADER: Missing menuId.");
    return json({ error: "Missing menuId parameter" }, { status: 400 });
  }

  try {
    console.log("EXPORT DATA LOADER: Fetching menu details for ID:", menuId);
    const response = await admin.graphql(GET_MENU_DETAILS_QUERY, {
      variables: { id: menuId },
    });
    const responseJson = await response.json();

    if (responseJson.errors || !responseJson.data?.menu) {
      console.error("EXPORT DATA LOADER: GQL Error or no menu data:", responseJson.errors);
      return json({ error: "Failed to fetch menu details", details: responseJson.errors || "No menu data found." }, { status: 500 });
    }

    const menuData = responseJson.data.menu;
    const exportPayload = {
      originalHandle: menuData.handle,
      originalTitle: menuData.title,
      items: prepareMenuItemsForCreate(menuData.items), // Ensure this function is robust
    };
    console.log("EXPORT DATA LOADER: Returning menu data for client-side download.");
    return json(exportPayload); // Return the data as JSON

  } catch (error) {
    console.error("EXPORT DATA LOADER: Error processing export:", error);
    if (error instanceof Response) throw error;
    return json({ error: "Unexpected error during export data preparation", details: error.message }, { status: 500 });
  }
}