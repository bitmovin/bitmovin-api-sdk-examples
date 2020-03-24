using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;

namespace Bitmovin.Api.Sdk.Examples.common
{
    public class ExampleRunner
    {
        public static async Task Main(string[] args)
        {
            CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;

            // Get all classes implementing IExample
            var examples = Assembly.GetExecutingAssembly().GetTypes()
                .Where(type => typeof(IExample).IsAssignableFrom(type) && !type.IsAbstract && !type.IsInterface)
                .ToList();

            if (args.Length == 0)
            {
                PrintHelp("Please provide an example name.", examples);
                return;
            }

            var exampleType =
                examples.SingleOrDefault(type => type.Name.Equals(args[0], StringComparison.OrdinalIgnoreCase));

            if (exampleType == null)
            {
                PrintHelp("Please provide a valid example. ", examples);
                return;
            }

            var exampleConstructor = exampleType.GetConstructor(Type.EmptyTypes);
            var exampleObject = (IExample) exampleConstructor.Invoke(new object[] { });
            await exampleObject.RunExample(args);
        }

        private static void PrintHelp(string message, List<Type> examples)
        {
            Console.WriteLine(message);

            Console.WriteLine("Following examples are available:");
            foreach (var exampleName in examples.Select(type => type.Name))
            {
                Console.WriteLine("- {0}", exampleName);
            }
        }
    }
}
