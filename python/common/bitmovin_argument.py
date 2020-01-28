class BitmovinArgument(object):
    def __init__(self, argument_name, description, required=False, value=None):
        self.argument_name = argument_name
        self.description = description
        self.required = required
        self.value = value
