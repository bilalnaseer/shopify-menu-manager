// app/routes/app._index.jsx

import { Form as RemixForm } from "@remix-run/react";
import { useState, useCallback, useEffect } from "react";
import { unstable_createMemoryUploadHandler, unstable_parseMultipartFormData } from "@remix-run/node";
import {
  useLoaderData,
  useActionData,
  useNavigation,
  useFetcher,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  Select,
  TextField,
  Banner,
  Spinner,
  InlineError,
  Form,
  FormLayout,
  DropZone,
  LegacyStack,
  Thumbnail,
  Toast,
  Frame,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

// GraphQL Query to get Menu IDs and Titles
const GET_MENUS_IDS_QUERY = `
  query getMenusIds {
    menus(first: 25) {
      edges {
        node {
          id
          title
        }
      }
    }
  }
`;

// GraphQL Mutation to create a Menu
const CREATE_MENU_MUTATION = `
  mutation CreateMenu($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
    menuCreate(title: $title, handle: $handle, items: $items) {
      menu {
        id
        handle
        title
      }
      userErrors {
        code
        field
        message
      }
    }
  }
`;

// Helper function to prepare menu items (used by Import and Duplicate)
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

// Loader for the main page
export const loader = async ({ request }) => {
  let adminInstance;
  try {
    const authResult = await authenticate.admin(request);
    adminInstance = authResult.admin;
    if (!adminInstance || typeof adminInstance.graphql !== 'function') {
      console.error("Loader: Authentication successful, but admin instance or graphql method is missing.");
      return Response.json({ menus: [], errors: [{ message: "Admin context not available after authentication." }], actionName: null }, { status: 500 });
    }
  } catch (error) {
    console.error("Loader: Error during authentication:", error);
    if (error instanceof Response) {
      throw error;
    }
    return Response.json({ menus: [], errors: [{ message: "Authentication failed or an unexpected error occurred." }], actionName: null }, { status: 500 });
  }

  try {
    const response = await adminInstance.graphql(GET_MENUS_IDS_QUERY);
    const responseJson = await response.json();
    if (responseJson.errors) {
      console.error("Loader: GraphQL Errors fetching menus:", responseJson.errors);
      return Response.json({ menus: [], errors: responseJson.errors, actionName: null });
    }
    const menus = responseJson.data?.menus?.edges.map(edge => edge.node) || [];
    return Response.json({ menus, errors: null, actionName: null });
  } catch (error) {
    console.error("Loader: Error fetching menus with admin instance:", error);
    if (error instanceof Response) {
      throw error;
    }
    return Response.json({ menus: [], errors: [{ message: "Failed to fetch menus after authentication." }], actionName: null }, { status: 500 });
  }
};

// Action function for form submissions
export const action = async ({ request }) => {
  const authResult = await authenticate.admin(request); // Get admin instance
  const admin = authResult.admin; // Assuming authResult.admin
  
  if (!admin || typeof admin.graphql !== 'function') {
      // Handle case where admin is not available after authentication attempt
      console.error("Action: Admin context not available.");
      // Return a generic error or specific error for the action type
      return Response.json({ success: false, errors: [{ message: "Admin context not available for action." }]});
  }

  const contentType = request.headers.get("Content-Type") || "";
  let formData;
  if (contentType.includes("multipart/form-data")) {
    const uploadHandler = unstable_createMemoryUploadHandler({ maxPartSize: 5_000_000 });
    formData = await unstable_parseMultipartFormData(request, uploadHandler);
  } else {
    formData = await request.formData();
  }

  const actionType = formData.get("_action");

  if (actionType === "duplicateMenu") {
    const originalMenuId = formData.get("originalMenuId");
    const newMenuTitle = formData.get("newMenuTitle")?.toString().trim();
    const GET_MENU_DETAILS_QUERY_ACTION = `
      query getMenu($id: ID!) {
        menu(id: $id) {
          items { title url type resourceId items { title url type resourceId items { title url type resourceId } } }
        }
      }
    `; // Condensed for brevity, ensure all levels are there

    if (!originalMenuId || !newMenuTitle) {
      return Response.json({ actionName: "duplicateMenu", success: false, errors: [{ field: ["form"], message: "Original menu and new title are required." }] });
    }
    try {
      const menuDetailsResponse = await admin.graphql(GET_MENU_DETAILS_QUERY_ACTION, { variables: { id: originalMenuId } });
      const menuDetailsJson = await menuDetailsResponse.json();
      if (menuDetailsJson.errors || !menuDetailsJson.data?.menu) {
        return Response.json({ actionName: "duplicateMenu", success: false, errors: menuDetailsJson.errors || [{ message: "Failed to fetch original menu details." }] });
      }
      const originalMenuData = menuDetailsJson.data.menu;
      const preparedItems = prepareMenuItemsForCreate(originalMenuData.items);
      const newMenuHandle = `${newMenuTitle.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]+/g, "")}-${Math.random().toString(36).substring(2, 8)}`;
      const createResponse = await admin.graphql(CREATE_MENU_MUTATION, { variables: { title: newMenuTitle, handle: newMenuHandle, items: preparedItems } });
      const createResponseJson = await createResponse.json();
      if (createResponseJson.data?.menuCreate?.userErrors?.length) {
        return Response.json({ actionName: "duplicateMenu", success: false, errors: createResponseJson.data.menuCreate.userErrors });
      }
      if (createResponseJson.errors || !createResponseJson.data?.menuCreate?.menu) {
        return Response.json({ actionName: "duplicateMenu", success: false, errors: createResponseJson.errors || [{ message: "Failed to create new menu." }] });
      }
      return Response.json({ actionName: "duplicateMenu", success: true, createdMenu: createResponseJson.data.menuCreate.menu, message: `Menu "${newMenuTitle}" duplicated successfully! New handle: ${newMenuHandle}` });
    } catch (error) {
      console.error("Error in duplicateMenu action:", error);
      return Response.json({ actionName: "duplicateMenu", success: false, errors: [{ message: error.message || "An unexpected error occurred." }] });
    }
  } else if (actionType === "importMenu") {
    const newMenuTitle = formData.get("newImportMenuTitle")?.toString().trim();
    const uploadedFile = formData.get("menuFile");
    if (!newMenuTitle || !uploadedFile || typeof uploadedFile === 'string' || uploadedFile.size === 0) {
      return Response.json({ actionName: "importMenu", success: false, errors: [{ field: ["form"], message: "New menu title and a valid JSON file are required." }] });
    }
    try {
      const fileContent = await uploadedFile.text();
      let importedData;
      try {
        importedData = JSON.parse(fileContent);
      } catch (e) {
        return Response.json({ actionName: "importMenu", success: false, errors: [{ field: ["file"], message: "Invalid JSON file." }] });
      }
      const itemsToImport = importedData.items;
      if (!Array.isArray(itemsToImport)) {
        return Response.json({ actionName: "importMenu", success: false, errors: [{ field: ["file"], message: "Invalid JSON: 'items' array not found." }] });
      }
      const preparedImportedItems = prepareMenuItemsForCreate(itemsToImport);
      const newMenuHandle = `${newMenuTitle.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]+/g, "")}-${Math.random().toString(36).substring(2, 8)}`;
      const createResponse = await admin.graphql(CREATE_MENU_MUTATION, { variables: { title: newMenuTitle, handle: newMenuHandle, items: preparedImportedItems } });
      const createResponseJson = await createResponse.json();
      if (createResponseJson.data?.menuCreate?.userErrors?.length) {
        return Response.json({ actionName: "importMenu", success: false, errors: createResponseJson.data.menuCreate.userErrors });
      }
      if (createResponseJson.errors || !createResponseJson.data?.menuCreate?.menu) {
        return Response.json({ actionName: "importMenu", success: false, errors: createResponseJson.errors || [{ message: "Failed to create menu from import." }] });
      }
      return Response.json({ actionName: "importMenu", success: true, createdMenu: createResponseJson.data.menuCreate.menu, message: `Menu "${newMenuTitle}" imported successfully!` });
    } catch (error) {
      console.error("Error in importMenu action:", error);
      return Response.json({ actionName: "importMenu", success: false, errors: [{ message: error.message || "An unexpected error occurred during import." }] });
    }
  }
  return Response.json({ success: false, errors: [{ message: "Invalid action." }] });
};

// React Component
export default function Index() {
  const { menus, errors: loaderErrors } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const exportFetcher = useFetcher();

  const [selectedMenuIdForDuplicate, setSelectedMenuIdForDuplicate] = useState(menus?.[0]?.id || "");
  const [newMenuTitleForDuplicate, setNewMenuTitleForDuplicate] = useState("");

  const [selectedMenuIdForExport, setSelectedMenuIdForExport] = useState(menus?.[0]?.id || "");
  const [exportUserMessage, setExportUserMessage] = useState("");
  const [showExportToast, setShowExportToast] = useState(false);

  const [newMenuTitleForImport, setNewMenuTitleForImport] = useState("");
  const [fileToImport, setFileToImport] = useState(null);
  const [importFormErrors, setImportFormErrors] = useState([]);

  console.log("Current fileToImport state:", fileToImport); // Log fileToImport on re-renders

  const isLoading = navigation.state === "submitting" || navigation.state === "loading";
  const isDuplicating = navigation.state === "submitting" && navigation.formData?.get("_action") === "duplicateMenu";
  const isImporting = navigation.state === "submitting" && navigation.formData?.get("_action") === "importMenu";
  const isExporting = exportFetcher.state !== "idle";

  const menuOptions = menus?.map((menu) => ({ label: menu.title, value: menu.id })) || [];

  useEffect(() => {
    if (menus?.length > 0 && menuOptions.length > 0) { // Check menuOptions too
      if (!selectedMenuIdForDuplicate) setSelectedMenuIdForDuplicate(menuOptions[0].value);
      if (!selectedMenuIdForExport) setSelectedMenuIdForExport(menuOptions[0].value);
    }
  }, [menus, menuOptions, selectedMenuIdForDuplicate, selectedMenuIdForExport]);

  useEffect(() => {
    if (actionData?.actionName === "duplicateMenu" && actionData?.success) {
      setNewMenuTitleForDuplicate("");
    }
    if (actionData?.actionName === "importMenu") {
      if (actionData?.success) {
        setNewMenuTitleForImport("");
        setFileToImport(null);
        setImportFormErrors([]);
      } else if (actionData?.errors) {
        setImportFormErrors(actionData.errors);
        const isFileError = actionData.errors.some(err => err.field?.includes('file'));
        if (isFileError) {
            setFileToImport(null); // Clear file if the error was file-related
        }
      }
    }
  }, [actionData]);

  const handleExportMenu = useCallback(() => {
    if (!selectedMenuIdForExport) {
      setExportUserMessage("Please select a menu to export.");
      setShowExportToast(true);
      return;
    }
    setExportUserMessage("");
    exportFetcher.load(`/app/export-menu.json?menuId=${selectedMenuIdForExport}`);
  }, [selectedMenuIdForExport, exportFetcher]);

  useEffect(() => {
    if (exportFetcher.data) {
      if (exportFetcher.data.error) {
        console.error("Export error from fetcher:", exportFetcher.data.error, exportFetcher.data.details);
        setExportUserMessage(`Export failed: ${exportFetcher.data.details || exportFetcher.data.error}`);
      } else {
        const menuToExport = exportFetcher.data;
        const jsonString = JSON.stringify({ items: menuToExport.items }, null, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const handle = menuToExport.originalHandle || menuToExport.originalTitle?.toLowerCase().replace(/\s+/g, '-') || "menu";
        a.download = `${handle}-export.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setExportUserMessage("Menu exported successfully!");
      }
      setShowExportToast(true);
    }
  }, [exportFetcher.data]);

  const toggleExportToastActive = useCallback(() => setShowExportToast((active) => !active), []);
  const exportToastMarkup = showExportToast ? ( <Toast content={exportUserMessage} error={exportUserMessage.toLowerCase().includes("failed")} onDismiss={toggleExportToastActive} duration={4000}/>) : null;

  const handleSelectChangeForDuplicate = useCallback((value) => setSelectedMenuIdForDuplicate(value), []);
  const handleTitleChangeForDuplicate = useCallback((value) => setNewMenuTitleForDuplicate(value), []);
  const duplicateFormErrors = actionData?.actionName === "duplicateMenu" && actionData?.errors?.filter(err => err.field?.includes('form'));
  const duplicateTitleFieldErrorMsg = actionData?.actionName === "duplicateMenu" && actionData?.errors?.find(err => err.field?.includes('title') || err.field?.includes('newMenuTitle'))?.message;

  const handleSelectChangeForExport = useCallback((value) => setSelectedMenuIdForExport(value), []);

  const handleTitleChangeForImport = useCallback((value) => setNewMenuTitleForImport(value), []);
  const handleDropZoneDrop = useCallback((_dropFiles, acceptedFiles, _rejectedFiles) => {
      console.log("File dropped into DropZone. Accepted files:", acceptedFiles);
      if (acceptedFiles && acceptedFiles.length > 0) {
        setFileToImport(acceptedFiles[0]);
        console.log("fileToImport state will be set to:", acceptedFiles[0]);
      } else {
        console.log("No accepted files, or empty acceptedFiles array.");
        setFileToImport(null);
      }
      setImportFormErrors([]);
    },[]);

  const importTitleFieldErrorMsg = importFormErrors.find(err => err.field?.includes('newImportMenuTitle') || err.field?.includes('title'))?.message;
  const importFileErrorMsg = importFormErrors.find(err => err.field?.includes('file'))?.message;
  const importGenericFormErrorMsg = importFormErrors.find(err => err.field?.includes('form'))?.message;

  const validImageTypes = ['image/gif', 'image/jpeg', 'image/png', 'application/json'];
  const fileUpload = !fileToImport && <DropZone.FileUpload actionHint="or drop files to upload" />;
  const uploadedFileDisplay = fileToImport && (
    <LegacyStack spacing="tight">
      <Thumbnail size="small" alt={fileToImport.name} source={validImageTypes.includes(fileToImport.type) && fileToImport.type !== 'application/json' ? window.URL.createObjectURL(fileToImport) : 'https://cdn.shopify.com/s/files/1/0757/9955/files/New_Project.png?12678704907400085459'}/>
      <div>{fileToImport.name} <Text variant="bodySm" as="p">{fileToImport.size} bytes</Text></div>
    </LegacyStack>
  );

  return (
    <Frame>
      <Page>
        <TitleBar title="Easy Menu Manager" />
        <BlockStack gap="500">
          <Layout>
            <Layout.Section>
              {/* Duplicate Menu Card */}
              <Card sectioned title="Duplicate Menu">
                <RemixForm method="post">
                  <FormLayout>
                    <input type="hidden" name="_action" value="duplicateMenu" />
                    {loaderErrors && (<Box paddingBlockEnd="200"><Banner title="Error loading menus" tone="critical">{loaderErrors.map((e, i) => <Text as="p" key={i}>{e.message}</Text>)}</Banner></Box>)}
                    {menuOptions.length > 0 ? (
                      <Select label="Select Menu to Duplicate" options={menuOptions} onChange={handleSelectChangeForDuplicate} value={selectedMenuIdForDuplicate} name="originalMenuId" disabled={isLoading} />
                    ) : (!isLoading && !loaderErrors && <Text as="p">No menus found.</Text>)}
                    <TextField label="New Menu Title" value={newMenuTitleForDuplicate} onChange={handleTitleChangeForDuplicate} name="newMenuTitle" autoComplete="off" error={duplicateTitleFieldErrorMsg} disabled={isLoading} placeholder="e.g., My Awesome New Menu"/>
                    {duplicateFormErrors?.length > 0 && duplicateFormErrors.map((err, idx) => (<InlineError key={idx} message={err.message} fieldID={`dupFormError${idx}`} />))}
                    <Button variant="primary" submit disabled={isDuplicating || !selectedMenuIdForDuplicate || !newMenuTitleForDuplicate.trim()}>
                      {isDuplicating ? <Spinner accessibilityLabel="Duplicating" size="small" /> : "Duplicate Menu"}
                    </Button>
                  </FormLayout>
                </RemixForm>
                {actionData && actionData.actionName === "duplicateMenu" && (
                  <Box paddingBlockStart="400">
                    {actionData.success && (<Banner title="Success!" tone="success"><p>{actionData.message}</p></Banner>)}
                    {actionData.errors && !actionData.success && (<Banner title="Error Duplicating Menu" tone="critical"><BlockStack gap="100">{actionData.errors.map((error, index) => (<Text as="p" key={index}>{error.field ? `Field: ${error.field.join(", ")} - ` : ""}{error.message}</Text>))}</BlockStack></Banner>)}
                  </Box>
                )}
              </Card>

              {/* Export Menu Card */}
              <Card sectioned title="Export Menu">
                <FormLayout>
                  {menuOptions.length > 0 ? (
                    <Select label="Select Menu to Export" options={menuOptions} onChange={handleSelectChangeForExport} value={selectedMenuIdForExport} disabled={isLoading || isExporting} />
                  ) : (!isLoading && !loaderErrors && <Text as="p">No menus found.</Text>)}
                  <Button onClick={handleExportMenu} disabled={!selectedMenuIdForExport || isLoading || isExporting} primary>
                    {isExporting ? <Spinner accessibilityLabel="Exporting" size="small" /> : "Export Selected Menu"}
                  </Button>
                  {exportFetcher.data?.error && !isExporting && (<Box paddingTop="200"><InlineError message={`Export failed: ${exportFetcher.data.details || exportFetcher.data.error}`} fieldID="exportErrorDisplay" /></Box>)}
                </FormLayout>
              </Card>

              {/* Import Menu Card */}
              <Card sectioned title="Import Menu">
                <RemixForm method="post" encType="multipart/form-data">
                  <FormLayout>
                    <input type="hidden" name="_action" value="importMenu" />
                    <TextField label="New Menu Title for Imported Menu" value={newMenuTitleForImport} onChange={handleTitleChangeForImport} name="newImportMenuTitle" autoComplete="off" placeholder="e.g., Imported Main Menu" error={importTitleFieldErrorMsg} disabled={isImporting} />
                    <DropZone label="Menu JSON File" allowMultiple={false} onDrop={handleDropZoneDrop} accept=".json" error={importFileErrorMsg} disabled={isImporting} name="menuFileProxy"> {/* Added proxy name for clarity, actual file input name is important */}
                      {/* The actual file input needs name="menuFile" if DropZone doesn't handle it. */}
                      {/* For now, assuming DropZone + Remix form magically works or we debug if file is not in formData */}
                      {uploadedFileDisplay}
                      {fileUpload}
                    </DropZone>
                    {importGenericFormErrorMsg && (<InlineError message={importGenericFormErrorMsg} fieldID="importFormError" />)}
                    <Button variant="primary" submit disabled={isImporting || !newMenuTitleForImport.trim() || !fileToImport}>
                      {isImporting ? <Spinner accessibilityLabel="Importing" size="small" /> : "Import Menu"}
                    </Button>
                  </FormLayout>
                </RemixForm>
                {actionData && actionData.actionName === "importMenu" && (
                  <Box paddingBlockStart="400">
                    {actionData.success && (<Banner title="Success!" tone="success"><p>{actionData.message}</p></Banner>)}
                    {actionData.errors && !actionData.success && (<Banner title="Error Importing Menu" tone="critical"><BlockStack gap="100">{actionData.errors.map((error, index) => (<Text as="p" key={index}>{error.field ? `Field: ${error.field.join(", ")} - ` : ""}{error.message}</Text>))}</BlockStack></Banner>)}
                  </Box>
                )}
              </Card>
            </Layout.Section>
          </Layout>
        </BlockStack>
        {exportToastMarkup}
      </Page>
    </Frame>
  );
}