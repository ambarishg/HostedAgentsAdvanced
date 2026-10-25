Create a complete authorization service.

The UI should interact with the authorization service to obtain the necessary authorization headers for different API operations. This ensures that each request is properly authorized according to the defined policies.

Once the authorization service is in place, the individual API endpoints no longer need to handle authorization directly. They can simply rely on the service to validate the authorization headers and enforce the required policies.

Move all authorization logic from the individual API endpoints to the authorization service. This centralizes the authorization checks and ensures consistency across the application.


