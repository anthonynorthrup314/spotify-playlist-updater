let playlistID: string = "";
let refreshOnModalHide = false;
let requestID = 0;
let errorModalVisible = false;

const modal: JQuery<HTMLDivElement> = $("#updateModal");
const modalHeader: JQuery<HTMLHeadingElement> = $("#updateModalLabel");
const modalBody: JQuery<HTMLDivElement> = $("#updateModalBody");
const submitButton: JQuery<HTMLButtonElement> = $("#submitButton");
const updateButton: JQuery<HTMLButtonElement> = $("#updateButton");

const errorModal: JQuery<HTMLDivElement> = $("#errorModal");
const errorModalBody: JQuery<HTMLDivElement> = $("#errorModalBody");

modal.on("show.bs.modal", () => {
    // Already got latest tracks?
    if (modalBody.find("input[type=checkbox]").length)
        return;

    // Disable the submit button
    submitButton.prop("disabled", true);

    // Update the content to a spinner
    modalBody.html(`
        <div class="text-center">
            <div class="spinner-border text-primary" role="status">
                <span class="sr-only">Loading tracks...</span>
            </div>
        </div>
    `);

    // Start the web request
    getLatestTracks();
});

modal.on("hidden.bs.modal", () => {
    if (errorModalVisible)
        return;

    // Refresh the page?
    if (refreshOnModalHide)
        window.location.reload();
    else
        // Enable the update button again
        updateButton.prop("disabled", false);
});

submitButton.on("click", async () => {
    // Disable the submit button
    submitButton.prop("disabled", true);

    // Send the request
    await submitNewTracks();

    // Hide the modal, and refresh
    refreshOnModalHide = true;
    modal.modal("hide");
});

updateButton.on("click", () => {
    updateButton.prop("disabled", true);
    modal.modal("show");
});

errorModal.on("show.bs.modal", () => {
    errorModalVisible = true;
})

errorModal.on("hidden.bs.modal", () => {
    errorModalVisible = false;

    // Refresh the page?
    if (refreshOnModalHide)
        window.location.reload();
    else
        // Enable the update button again
        updateButton.prop("disabled", false);
});

async function getLatestTracks(): Promise<void> {
    // Increment the request ID
    const myRequestID = ++requestID;

    // Request tracks from endpoint
    const resp = await fetch(`/playlist/${playlistID}/latest`);

    if (myRequestID !== requestID)
        // Someone closed/reopened the dialog, let the other request do its thing
        return;

    // Update the modal
    const content = await resp.text();
    modalBody.html(content);

    if (resp.status === 200) {
        // If initial update, enable refresh on close
        if (resp.headers.get("X-Initial-Update") === "true")
            refreshOnModalHide = true;

        // Had actual results?
        const checkboxes = modalBody.find("input[type=checkbox]");
        if (checkboxes.length) {
            // Default all checkboxes to true
            checkboxes.prop("checked", true);

            // Handle clicking on group items
            modalBody.find(".list-group-item-action").on("click", newTrackClicked);
            modalBody.find(".list-group-item-action a").on("click", newTrackLinkClicked);

            // Update the title to specify the number of tracks
            modalHeader.text(`${checkboxes.length} New Track${checkboxes.length === 1 ? "" : "s"}`);
        }

        // Enable the submit button
        submitButton.prop("disabled", false);
    } else
        // Refresh when closed
        refreshOnModalHide = true;
}

const newTrackClicked: (this: HTMLElement) => void = function () {
    const checkbox = $(this).find("input[type=checkbox]");
    checkbox.prop("checked", !checkbox.prop("checked"));
};

function newTrackLinkClicked(e: Event): void {
    e.stopPropagation();
}

async function submitNewTracks(): Promise<void> {
    // Disable the submit button
    submitButton.prop("disabled", true);

    // Parse the date
    const dateArtistWasChecked = new Date(modalBody.find("#date-artist-was-checked").data("date"));

    // Get the selected tracks
    const trackURIs: string[] = [];
    for (const checkbox of modalBody.find("input[type=checkbox]"))
        if ($(checkbox).prop("checked"))
            trackURIs.push($(checkbox).data("track-uri"));

    // Show a spinner on the add track button
    submitButton.width(`${submitButton.width()}px`);
    submitButton.height(`${submitButton.height()}px`);
    submitButton.html(`
        <div class="text-center">
            <div class="spinner-border spinner-border-sm text-light" role="status">
                <span class="sr-only">Adding tracks...</span>
            </div>
        </div>
    `);

    // Push tracks to endpoint
    const resp = await fetch(`/playlist/${playlistID}/update`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            dateArtistWasChecked,
            trackURIs
        })
    });

    // Always refresh when closed
    refreshOnModalHide = true;

    if (resp.status === 200)
        // Just close
        modal.modal("hide");
    else {
        // Get/display the error
        const content = await resp.text();
        errorModalBody.html(content);
        errorModal.modal("show");
    }
}