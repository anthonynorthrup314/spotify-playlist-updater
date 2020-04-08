async function refresh(self: HTMLButtonElement, playlistID?: string): Promise<void> {
    // Disable the button
    const button = $(self);
    button.prop("disabled", true);

    // Keep the size of the button the same
    button.width(`${button.width()}px`);
    button.height(`${button.height()}px`);

    // Update the content to a spinner
    button.html(`
        <div class="text-center">
            <div class="spinner-border spinner-border-sm text-light" role="status">
                <span class="sr-only">Refreshing...</span>
            </div>
        </div>
    `);

    // Perform the server-side refresh
    if (playlistID)
        await fetch(`/refresh/${playlistID}`);
    else
        await fetch("/refresh");

    // Reload the page
    window.location.reload();
}