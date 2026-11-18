import importlib
import json
import os
import sys
import traceback
import time
import requests


# Error handling function to report errors back to the Lambda runtime API
def report_error(ex, context=None):
    error_response = {
        "errorType": "Error",
        "errorMessage": str(ex),
        "trace": traceback.format_exc().split("\n"),
    }

    endpoint = (
        f"{AWS_LAMBDA_RUNTIME_API}/runtime/init/error"
        if context is None
        else f"{AWS_LAMBDA_RUNTIME_API}/runtime/invocation/{context['awsRequestId']}/error"
    )
    requests.post(
        endpoint,
        headers={"Content-Type": "application/json"},
        data=json.dumps(error_response),
    )


def log(message):
    print(message, flush=True)
    sys.stdout.flush()
    sys.stderr.flush()


# Parse the handler from command-line arguments
handler = sys.argv[1]  # Expecting the format 'module.function'
AWS_LAMBDA_RUNTIME_API = f"http://{os.environ['AWS_LAMBDA_RUNTIME_API']}/2018-06-01"

# If the handler is given as a file path, split it to get the directory and module
module_path, function_name = handler.rsplit(".", 1)
module_dir = os.path.dirname(module_path)
module_name = os.path.basename(module_path)

# Add the directory containing the module to the system path
sys.path.insert(0, module_dir)

try:
    # Dynamically load the module from the file path
    module = importlib.import_module(module_name)

    # Get the function from the module
    handler_function = getattr(module, function_name)
    if not callable(handler_function):
        raise ImportError(
            f"{function_name} is not a callable function in {module_name}"
        )
except Exception as ex:
    report_error(ex)
    sys.exit(1)

# Simulating Lambda's event loop
while True:
    try:
        # Get the next event to process
        response = requests.get(f"{AWS_LAMBDA_RUNTIME_API}/runtime/invocation/next")
        response.raise_for_status()

        context = {
            "awsRequestId": response.headers.get("Lambda-Runtime-Aws-Request-Id"),
            "invokedFunctionArn": response.headers.get(
                "Lambda-Runtime-Invoked-Function-Arn"
            ),
            "getRemainingTimeInMillis": lambda: max(
                int(response.headers.get("Lambda-Runtime-Deadline-Ms"))
                - int(time.time() * 1000),
                0,
            ),
            "functionName": os.environ.get("AWS_LAMBDA_FUNCTION_NAME"),
            "functionVersion": os.environ.get("AWS_LAMBDA_FUNCTION_VERSION"),
            "memoryLimitInMB": os.environ.get("AWS_LAMBDA_FUNCTION_MEMORY_SIZE"),
            "logGroupName": os.environ.get("AWS_LAMBDA_LOG_GROUP_NAME"),
            "logStreamName": os.environ.get("AWS_LAMBDA_LOG_STREAM_NAME"),
        }

        event = response.json()

    except Exception as ex:
        log(f"Error getting next invocation: {ex}")
        report_error(ex)
        continue

    # Run the handler function
    try:
        result = handler_function(event, context)
    except Exception as ex:
        log(f"Error running handler: {ex}")
        report_error(ex, context)
        continue

    # Send the response back to Lambda
    while True:
        try:
            requests.post(
                f"{AWS_LAMBDA_RUNTIME_API}/runtime/invocation/{context['awsRequestId']}/response",
                headers={"Content-Type": "application/json"},
                data=json.dumps(result),
            )
            break
        except Exception as _:
            time.sleep(0.5)
            continue

    sys.stdout.flush()
    sys.stderr.flush()
